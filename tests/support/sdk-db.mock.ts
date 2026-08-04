export interface ColumnDescriptor {
  readonly kind: 'column';
  readonly name: string;
  readonly dataType: string;
  readonly modifiers: string[];
}

export interface ConstraintDescriptor {
  readonly kind: 'index' | 'unique';
  readonly name: string;
  readonly columns: readonly string[];
}

export interface TableDescriptor {
  readonly kind: 'table';
  readonly name: string;
  readonly columns: Readonly<Record<string, ColumnDescriptor>>;
  readonly constraints: Readonly<Record<string, ConstraintDescriptor>>;
}

class ColumnBuilder implements ColumnDescriptor {
  public readonly kind = 'column' as const;
  public readonly modifiers: string[] = [];

  public constructor(
    public readonly name: string,
    public readonly dataType: string
  ) {}

  public primaryKey(options?: { autoIncrement?: boolean }): this {
    this.modifiers.push(options?.autoIncrement === true ? 'primaryKey:autoIncrement' : 'primaryKey');
    return this;
  }

  public notNull(): this {
    this.modifiers.push('notNull');
    return this;
  }

  public unique(): this {
    this.modifiers.push('unique');
    return this;
  }

  public default(value: unknown): this {
    this.modifiers.push(`default:${String(value)}`);
    return this;
  }
}

class ConstraintBuilder {
  public constructor(
    private readonly kind: 'index' | 'unique',
    private readonly name: string
  ) {}

  public on(...columns: readonly ColumnDescriptor[]): ConstraintDescriptor {
    return {
      kind: this.kind,
      name: this.name,
      columns: columns.map((column) => column.name)
    };
  }
}

type Columns = Readonly<Record<string, ColumnDescriptor>>;

export function table(
  name: string,
  columns: Columns,
  extras?: (columns: Columns) => Readonly<Record<string, ConstraintDescriptor>>
): TableDescriptor {
  return {
    kind: 'table',
    name,
    columns,
    constraints: extras?.(columns) ?? {}
  };
}

export function integer(name: string, options?: { mode?: string }): ColumnBuilder {
  void options;
  return new ColumnBuilder(name, 'integer');
}

export function text(name: string): ColumnBuilder {
  return new ColumnBuilder(name, 'text');
}

export function boolean(name: string): ColumnBuilder {
  return new ColumnBuilder(name, 'boolean');
}

export function json(name: string): ColumnBuilder {
  return new ColumnBuilder(name, 'json');
}

export function index(name: string): ConstraintBuilder {
  return new ConstraintBuilder('index', name);
}

export function unique(name: string): ConstraintBuilder {
  return new ConstraintBuilder('unique', name);
}
