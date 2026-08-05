import { parse } from 'csv-parse/sync';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const AIRPORTS_CSV_URL =
    'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';

interface AirportCsvRow {
    ident: string;
    type: string;
    name: string;
    latitude_deg: string;
    longitude_deg: string;
    elevation_ft: string;
    continent: string;
    iso_country: string;
    iso_region: string;
    municipality: string;
    scheduled_service: string;
    icao_code: string;
    iata_code: string;
    gps_code: string;
    local_code: string;
    home_link: string;
    wikipedia_link: string;
    keywords: string;
}

interface Airport {
    iataCode: string;
    icaoCode: string | null;
    name: string;
    city: string;
    countryCode: string;
    regionCode: string;
    latitude: number;
    longitude: number;
    type: string;
    hasScheduledService: boolean;
}

type IataMap = Record<string, Airport>;

async function downloadCsv(): Promise<string> {
    const response = await fetch(AIRPORTS_CSV_URL);

    if (!response.ok) {
        throw new Error(
            `Failed to download airports CSV: ${response.status} ${response.statusText}`,
        );
    }

    return response.text();
}

function buildIataMap(csv: string): IataMap {
    const rows = parse(csv, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        trim: true,
    }) as AirportCsvRow[];

    const map: IataMap = {};

    for (const row of rows) {
        const iataCode = row.iata_code?.trim().toUpperCase();
        const city = row.municipality?.trim();

        if (!iataCode || iataCode.length !== 3) {
            continue;
        }

        if (!city) {
            continue;
        }

        /*
         * Оставляем только аэропорты, которые обычно нужны
         * для поиска пассажирских билетов.
         */
        if (
            ![
                'large_airport',
                'medium_airport',
                'small_airport',
            ].includes(row.type)
        ) {
            continue;
        }

        map[iataCode] = {
            iataCode,
            icaoCode: row.icao_code?.trim() || null,
            name: row.name.trim(),
            city,
            countryCode: row.iso_country.trim(),
            regionCode: row.iso_region.trim(),
            latitude: Number(row.latitude_deg),
            longitude: Number(row.longitude_deg),
            type: row.type,
            hasScheduledService: row.scheduled_service === 'yes',
        };
    }

    return Object.fromEntries(
        Object.entries(map).sort(([firstCode], [secondCode]) =>
            firstCode.localeCompare(secondCode),
        ),
    );
}

async function main(): Promise<void> {
    const csv = await downloadCsv();
    const iataMap = buildIataMap(csv);

    const outputDirectory = path.resolve('generated');
    const jsonPath = path.join(outputDirectory, 'iata-airports.json');
    const tsPath = path.join(outputDirectory, 'iata-airports.ts');

    await mkdir(outputDirectory, { recursive: true });

    await writeFile(
        jsonPath,
        JSON.stringify(iataMap, null, 2),
        'utf8',
    );

    const tsContent = `
// This file is generated automatically.
// Do not edit it manually.

export interface Airport {
    iataCode: string;
    icaoCode: string | null;
    name: string;
    city: string;
    countryCode: string;
    regionCode: string;
    latitude: number;
    longitude: number;
    type: string;
    hasScheduledService: boolean;
}

export const IATA_AIRPORTS = ${JSON.stringify(iataMap, null, 4)} as const;

export type IataCode = keyof typeof IATA_AIRPORTS;

export function getAirportByIata(
    code: string,
): Airport | null {
    const normalizedCode = code.trim().toUpperCase();

    return IATA_AIRPORTS[
        normalizedCode as IataCode
    ] ?? null;
}
`.trimStart();

    await writeFile(tsPath, tsContent, 'utf8');

    console.log(`Generated ${Object.keys(iataMap).length} IATA airports`);
    console.log(`JSON: ${jsonPath}`);
    console.log(`TypeScript: ${tsPath}`);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});