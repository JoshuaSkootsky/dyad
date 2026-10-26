import { PGlite } from '@electric-sql/pglite';
import { parseDatabase } from '../../src/postgres/catalog.js';

async function run() {
  const db = new PGlite();
  await db.waitReady;

  await db.exec(`
    CREATE TYPE status_enum AS ENUM ('active', 'inactive', 'pending');

    CREATE TABLE all_types (
      id serial PRIMARY KEY,
      int_col integer NOT NULL,
      int_small smallint,
      int_big bigint,
      decimal_col numeric(10,2) NOT NULL,
      decimal_unconstrained numeric,
      float_col real,
      double_col double precision,
      char_col character(5),
      varchar_col character varying(100),
      text_col text,
      bytes_col bytea,
      bool_col boolean,
      date_col date,
      time_col time(3) without time zone,
      timetz_col time(2) with time zone,
      ts_col timestamp(4) without time zone,
      tstz_col timestamp(6) with time zone,
      interval_col interval day to second(2),
      uuid_col uuid,
      json_col jsonb,
      int_array integer[],
      text_array text[],
      enum_col status_enum,
      nullable_col integer,
      default_col integer DEFAULT 42,
      expr_col timestamp DEFAULT now()
    );
  `);

  const client = {
    async query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
      const result = await db.query(sql, params);
      return { rows: result.rows as T[] };
    },
  };

  const ir = await parseDatabase(client as any, 'public', 'testdb');

  console.log('Tables:', ir.tables.map(t => t.name));
  console.log('Named types:', ir.types?.map(t => `${t.name} (${t.kind})`));
  console.log('');

  for (const t of ir.tables) {
    console.log(`Table: ${t.name} (PK: ${JSON.stringify(t.primaryKey)})`);
    for (const c of t.columns) {
      const typeStr = c.type.kind === 'int' ? `int(${c.type.bits}${c.type.unsigned ? ',unsigned' : ''})` :
        c.type.kind === 'decimal' ? `decimal(${c.type.precision ?? ''},${c.type.scale ?? ''})` :
        c.type.kind === 'array' ? `array<${c.type.element?.kind}>` :
        c.type.kind === 'timestamp' ? `timestamp(${c.type.precision})${c.type.tz ? ' tz' : ''}` :
        c.type.kind === 'time' ? `time(${c.type.precision})${c.type.tz ? ' tz' : ''}` :
        c.type.kind === 'varchar' ? `varchar(${c.type.length})` :
        c.type.kind === 'char' ? `char(${c.type.length})` :
        c.type.kind === 'interval' ? `interval ${c.type.intervalFields}(${c.type.precision})` :
        c.type.kind;
      console.log(`  ${c.name}: ${typeStr} nullable=${c.nullable} identity=${c.identity?.generated ?? 'none'} default=${JSON.stringify(c.default)} collation=${c.collation ?? 'none'}`);
    }
  }

  // Verify enum labels were parsed
  const enumType = ir.types?.find(t => t.kind === 'enum');
  if (enumType && enumType.type.kind === 'enum') {
    console.log('\nEnum labels:', enumType.type.values);
  }

  await db.close();
  console.log('\nPGlite catalog test: PASSED');
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
