import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://api.travelpayouts.com/data/ru';

interface City {
    code: string;
    name: string;
    country_code: string;
    coordinates: {
        lat: number;
        lon: number;
    } | null;
    time_zone: string | null;
    name_translations?: Record<string, string>;
}

interface Airport {
    code: string;
    name: string;
    city_code: string;
    country_code: string;
    coordinates: {
        lat: number;
        lon: number;
    } | null;
    time_zone: string | null;
    name_translations?: Record<string, string>;
}

interface Country {
    code: string;
    name: string;
    currency: string | null;
    name_translations?: Record<string, string>;
}

interface IataLocation {
    code: string;
    type: 'city' | 'airport';
    name: string;
    cityCode: string;
    cityName: string | null;
    countryCode: string;
    countryName: string | null;
    airportName: string | null;
    latitude: number | null;
    longitude: number | null;
    timeZone: string | null;
}

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `Не удалось загрузить ${url}: ` +
            `${response.status} ${response.statusText}`,
        );
    }

    return response.json() as Promise<T>;
}

async function main(): Promise<void> {
    const [cities, airports, countries] = await Promise.all([
        fetchJson<City[]>(`${BASE_URL}/cities.json`),
        fetchJson<Airport[]>(`${BASE_URL}/airports.json`),
        fetchJson<Country[]>(`${BASE_URL}/countries.json`),
    ]);

    const citiesByCode = new Map(
        cities
            .filter((city) => city.code)
            .map((city) => [city.code.toUpperCase(), city]),
    );

    const countriesByCode = new Map(
        countries
            .filter((country) => country.code)
            .map((country) => [country.code.toUpperCase(), country]),
    );

    const locations: Record<string, IataLocation> = {};

    /*
     * Добавляем IATA-коды городов:
     * MOW — Москва
     * LON — Лондон
     * NYC — Нью-Йорк
     */
    for (const city of cities) {
        const code = city.code?.trim().toUpperCase();

        if (!code) {
            continue;
        }

        const country = countriesByCode.get(
            city.country_code?.toUpperCase(),
        );

        locations[code] = {
            code,
            type: 'city',
            name: city.name,
            cityCode: code,
            cityName: city.name,
            countryCode: city.country_code,
            countryName: country?.name ?? null,
            airportName: null,
            latitude: city.coordinates?.lat ?? null,
            longitude: city.coordinates?.lon ?? null,
            timeZone: city.time_zone ?? null,
        };
    }

    /*
     * Добавляем коды отдельных аэропортов:
     * TAS — аэропорт Ташкента
     * KSQ — аэропорт Карши
     * JFK — аэропорт Нью-Йорка
     */
    for (const airport of airports) {
        const code = airport.code?.trim().toUpperCase();

        if (!code) {
            continue;
        }

        const cityCode = airport.city_code?.trim().toUpperCase();
        const city = citiesByCode.get(cityCode);
        const country = countriesByCode.get(
            airport.country_code?.toUpperCase(),
        );

        locations[code] = {
            code,
            type: 'airport',
            name: city?.name ?? airport.name,
            cityCode,
            cityName: city?.name ?? null,
            countryCode: airport.country_code,
            countryName: country?.name ?? null,
            airportName: airport.name,
            latitude: airport.coordinates?.lat ?? null,
            longitude: airport.coordinates?.lon ?? null,
            timeZone: airport.time_zone ?? null,
        };
    }

    const sortedLocations = Object.fromEntries(
        Object.entries(locations).sort(([a], [b]) =>
            a.localeCompare(b),
        ),
    );

    const outputDirectory = path.resolve('generated');

    await mkdir(outputDirectory, {
        recursive: true,
    });

    await writeFile(
        path.join(outputDirectory, 'iata-locations-ru.json'),
        JSON.stringify(sortedLocations, null, 2),
        'utf8',
    );

    await writeFile(
        path.join(outputDirectory, 'iata-locations-ru.ts'),
        `export const IATA_LOCATIONS_RU = ${
            JSON.stringify(sortedLocations, null, 4)
        } as const;\n`,
        'utf8',
    );

    console.log(
        `Сгенерировано ${Object.keys(sortedLocations).length} локаций`,
    );
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});