import type { SQLiteDatabase } from 'expo-sqlite';
import { MockSQLiteDatabase } from './MockDatabase';

// Common database type that works on both native (SQLiteDatabase) and web (MockSQLiteDatabase)
export type AppDatabase = SQLiteDatabase | MockSQLiteDatabase;