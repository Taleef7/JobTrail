/**
 * MockSQLiteDatabase - In-memory database for web platform testing.
 * Implements the key methods of SQLiteDatabase used by our repositories.
 * Uses camelCase column names to match our TypeScript domain types.
 */

type Row = Record<string, any>;

export class MockSQLiteDatabase {
  private tables: Map<string, Row[]> = new Map();
  private idCounter: number = 0;
  private inTransaction: boolean = false;
  private transactionSnapshot: Map<string, Row[]> = new Map();

  private getTable(name: string): Row[] {
    if (!this.tables.has(name)) {
      this.tables.set(name, []);
    }
    return this.tables.get(name)!;
  }

  async execAsync(sql: string): Promise<void> {
    // Parse multi-statement SQL
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      await this.execStatement(stmt);
    }
  }

  private async execStatement(sql: string): Promise<void> {
    const upperSql = sql.toUpperCase().trim();

    // Handle PRAGMA user_version
    if (upperSql.startsWith('PRAGMA USER_VERSION')) {
      return; // No-op for mock
    }

    // Handle PRAGMA journal_mode
    if (upperSql.startsWith('PRAGMA JOURNAL_MODE')) {
      return; // No-op for mock
    }

    // Handle PRAGMA foreign_keys
    if (upperSql.startsWith('PRAGMA FOREIGN_KEYS')) {
      return; // No-op for mock
    }

    // Handle transaction statements
    if (upperSql === 'BEGIN' || upperSql.startsWith('BEGIN ')) {
      this.saveSnapshot();
      this.inTransaction = true;
      return;
    }
    if (upperSql === 'COMMIT' || upperSql.startsWith('COMMIT ')) {
      this.transactionSnapshot.clear();
      this.inTransaction = false;
      return;
    }
    if (upperSql === 'ROLLBACK' || upperSql.startsWith('ROLLBACK ')) {
      this.restoreSnapshot();
      this.inTransaction = false;
      return;
    }

    // Handle CREATE TABLE IF NOT EXISTS
    const createMatch = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(/i);
    if (createMatch) {
      const tableName = createMatch[1];
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, []);
      }
      return;
    }

    // Handle plain CREATE TABLE
    const plainCreateMatch = sql.match(/CREATE\s+TABLE\s+(\w+)\s*\(/i);
    if (plainCreateMatch) {
      const tableName = plainCreateMatch[1];
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, []);
      }
      return;
    }
  }

  async runAsync(sql: string, ...params: any[]): Promise<{ lastInsertRowId: number; changes: number }> {
    const flatParams = this.flattenParams(params);
    const upperSql = sql.toUpperCase().trim();

    // INSERT
    if (upperSql.startsWith('INSERT')) {
      return this.handleInsert(sql, flatParams);
    }

    // UPDATE
    if (upperSql.startsWith('UPDATE')) {
      return this.handleUpdate(sql, flatParams);
    }

    // DELETE
    if (upperSql.startsWith('DELETE')) {
      return this.handleDelete(sql, flatParams);
    }

    return { lastInsertRowId: 0, changes: 0 };
  }

  async getFirstAsync<T>(sql: string, ...params: any[]): Promise<T | null> {
    const flatParams = this.flattenParams(params);
    const rows = this.executeSelect(sql, flatParams);
    return (rows.length > 0 ? rows[0] : null) as T | null;
  }

  async getAllAsync<T>(sql: string, ...params: any[]): Promise<T[]> {
    const flatParams = this.flattenParams(params);
    const rows = this.executeSelect(sql, flatParams);
    return rows as T[];
  }

  private flattenParams(params: any[]): any[] {
    if (params.length === 1 && Array.isArray(params[0])) {
      return params[0];
    }
    return params;
  }

  private handleInsert(sql: string, params: any[]): { lastInsertRowId: number; changes: number } {
    // Parse: INSERT INTO tableName (col1, col2, ...) VALUES (?, ?, ...)
    const match = sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (!match) {
      console.warn('MockDB: Could not parse INSERT:', sql);
      return { lastInsertRowId: 0, changes: 0 };
    }

    const tableName = match[1];
    const columns = match[2].split(',').map(c => c.trim());
    const table = this.getTable(tableName);

    const row: Row = {};
    columns.forEach((col, i) => {
      row[col] = params[i] ?? null;
    });

    table.push(row);
    this.idCounter++;
    return { lastInsertRowId: this.idCounter, changes: 1 };
  }

  private handleUpdate(sql: string, params: any[]): { lastInsertRowId: number; changes: number } {
    // Parse: UPDATE tableName SET col1 = ?, col2 = ? WHERE id = ?
    const match = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(\w+)\s*=\s*\?/i);
    if (!match) {
      console.warn('MockDB: Could not parse UPDATE:', sql);
      return { lastInsertRowId: 0, changes: 0 };
    }

    const tableName = match[1];
    const setClauses = match[2];
    const whereColumn = match[3];
    const table = this.getTable(tableName);

    // Parse SET clauses
    const setParts = setClauses.split(',').map(s => s.trim());
    const setColumns: string[] = [];

    for (const part of setParts) {
      const colMatch = part.match(/(\w+)\s*=\s*\?/);
      if (colMatch) {
        setColumns.push(colMatch[1]);
      }
    }

    // The WHERE value is the last param
    const whereValue = params[params.length - 1];
    const setParamValues = params.slice(0, params.length - 1);

    let changes = 0;
    for (const row of table) {
      if (row[whereColumn] === whereValue) {
        setColumns.forEach((col, i) => {
          row[col] = setParamValues[i] ?? null;
        });
        changes++;
      }
    }

    return { lastInsertRowId: 0, changes };
  }

  private handleDelete(sql: string, params: any[]): { lastInsertRowId: number; changes: number } {
    // Parse: DELETE FROM tableName WHERE col = ?
    const match = sql.match(/DELETE\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
    if (!match) {
      console.warn('MockDB: Could not parse DELETE:', sql);
      return { lastInsertRowId: 0, changes: 0 };
    }

    const tableName = match[1];
    const whereColumn = match[2];
    const whereValue = params[0];
    const table = this.getTable(tableName);

    const initialLength = table.length;
    const filtered = table.filter(row => row[whereColumn] !== whereValue);
    this.tables.set(tableName, filtered);

    return { lastInsertRowId: 0, changes: initialLength - filtered.length };
  }

  private executeSelect(sql: string, params: any[]): Row[] {
    // Parse: SELECT [columns] FROM tableName [WHERE ...] [ORDER BY ...]
    // Supports both SELECT * and SELECT col1, col2, ...
    const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?\s*$/i);
    if (!selectMatch) {
      console.warn('MockDB: Could not parse SELECT:', sql);
      return [];
    }

    const tableName = selectMatch[2];
    const afterFrom = selectMatch[3] ? selectMatch[3].trim() : '';
    const orderByClause = selectMatch[4] ? selectMatch[4].trim() : '';
    const table = this.getTable(tableName);

    // Parse WHERE clause (everything between WHERE and ORDER BY / end)
    let whereClause = '';
    if (afterFrom) {
      if (orderByClause) {
        // The WHERE group captured everything including ORDER BY text
        // Actually, with the non-greedy (.+?) in the WHERE group, the regex engine
        // captures the minimal text that allows the ORDER BY group to match.
        // But when there's no =? param in WHERE (only IS NULL/IS NOT NULL),
        // the non-greedy may match empty. So we parse more carefully:
        // The WHERE capture stops at the start of ORDER BY
        whereClause = afterFrom.replace(new RegExp('\\s+ORDER\\s+BY\\s+' + this.escapeRegex(orderByClause) + '\\s*$', 'i'), '').trim();
      } else {
        whereClause = afterFrom;
      }
    }

    // Parse ORDER BY column and direction
    let orderBy: string | null = null;
    let orderDir = 'ASC';
    if (orderByClause) {
      const orderMatch = orderByClause.match(/(\w+)\s+(ASC|DESC)/i) || orderByClause.match(/(\w+)/i);
      if (orderMatch) {
        orderBy = orderMatch[1];
        if (orderMatch[2]) {
          orderDir = orderMatch[2].toUpperCase();
        }
      }
    }

    // Parse WHERE clause
    let filtered = [...table];

    if (whereClause) {
      // Handle: col = ? AND col2 IS NULL
      // Handle: col = ?
      const conditions = whereClause.split(/\s+AND\s+/i);
      let paramIndex = 0;

      for (const condition of conditions) {
        const trimmed = condition.trim();

        // col = ?
        const eqMatch = trimmed.match(/(\w+)\s*=\s*\?/);
        if (eqMatch) {
          const col = eqMatch[1];
          const value = params[paramIndex++];
          filtered = filtered.filter(row => row[col] === value);
          continue;
        }

        // col IS NULL
        const isNullMatch = trimmed.match(/(\w+)\s+IS\s+NULL/i);
        if (isNullMatch) {
          const col = isNullMatch[1];
          filtered = filtered.filter(row => row[col] === null || row[col] === undefined);
          continue;
        }

        // col IS NOT NULL
        const isNotNullMatch = trimmed.match(/(\w+)\s+IS\s+NOT\s+NULL/i);
        if (isNotNullMatch) {
          const col = isNotNullMatch[1];
          filtered = filtered.filter(row => row[col] !== null && row[col] !== undefined);
          continue;
        }
      }
    }

    // Sort
    if (orderBy) {
      filtered.sort((a, b) => {
        const aVal = a[orderBy!] ?? '';
        const bVal = b[orderBy!] ?? '';
        const cmp = String(aVal).localeCompare(String(bVal));
        return orderDir === 'DESC' ? -cmp : cmp;
      });
    }

    return filtered;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private saveSnapshot(): void {
    this.transactionSnapshot = new Map();
    for (const [name, rows] of this.tables) {
      this.transactionSnapshot.set(name, rows.map(r => ({ ...r })));
    }
  }

  private restoreSnapshot(): void {
    this.tables = new Map();
    for (const [name, rows] of this.transactionSnapshot) {
      this.tables.set(name, rows.map(r => ({ ...r })));
    }
    this.transactionSnapshot.clear();
  }
}