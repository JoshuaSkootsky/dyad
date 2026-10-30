# Contributing to dyad

## Development setup

```bash
# Install Bun (https://bun.sh)
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone https://github.com/skootsky/dyad.git
cd dyad
bun install

# Typecheck
bun run typecheck

# Run all tests
bun run test
```

## Running specific tests

```bash
bun test/postgres/pglite.ts      # Postgres happy path
bun test/postgres/matrix.ts      # Table-driven matrix
bun test/sqlite/basic.ts         # SQLite
bun test/mysql/basic.ts          # MySQL (requires MySQL server)
bun test/json-schema/basic.ts    # JSON Schema export
bun test/probe/typescript.ts     # Consumer probe
```

## MySQL tests

MySQL tests require a running MySQL 8+ server on port 3307 with user `root`/`root` and database `testdb`. You can use Docker:

```bash
docker run -d --name mysql-test -p 3307:3306 -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=testdb mysql:8
```

## Guidelines

- Keep changes focused on one goal per PR
- Add tests for new functionality
- Run `bun run test` before submitting
- Follow the existing code style (strict TypeScript, Zod schemas)
- Update GOALS.md if you complete a sub-goal

## License

MIT