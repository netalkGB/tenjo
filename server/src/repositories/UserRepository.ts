import { BaseRepository } from './BaseRepository';

export interface User {
  id: string;
  full_name: string | null;
  user_name: string;
  email: string;
  password: string;
  user_role: 'admin' | 'standard';
  settings: unknown;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface InsertUser {
  id?: string;
  full_name?: string | null;
  user_name: string;
  email: string;
  password: string;
  user_role?: 'admin' | 'standard';
  settings?: unknown;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: Date | null;
  updated_at?: Date | null;
}

export type UpdateUser = Partial<InsertUser>;

const COLUMNS = [
  'id',
  'full_name',
  'user_name',
  'email',
  'password',
  'user_role',
  'settings',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at'
] as const;

export class UserRepository extends BaseRepository {
  async findAll(): Promise<User[]> {
    const result = await this.pool.query(`SELECT * FROM "users"`);
    return result.rows as User[];
  }

  async findById(id: string): Promise<User | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "users" WHERE "id" = $1`,
      [id]
    );
    return result.rows[0] as User | undefined;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "users" WHERE "email" = $1`,
      [email]
    );
    return result.rows[0] as User | undefined;
  }

  async findByUserName(userName: string): Promise<User | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM "users" WHERE "user_name" = $1`,
      [userName]
    );
    return result.rows[0] as User | undefined;
  }

  async create(userData: InsertUser): Promise<User> {
    return await this.insertReturning<User>('users', { ...userData }, COLUMNS);
  }

  async update(id: string, userData: UpdateUser): Promise<User | undefined> {
    return await this.updateReturning<User>(
      'users',
      id,
      { ...userData },
      COLUMNS
    );
  }

  async existsAdmin(): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT "id" FROM "users" WHERE "user_role" = $1 LIMIT 1`,
      ['admin']
    );
    return result.rows.length > 0;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM "users" WHERE "id" = $1 RETURNING *`,
      [id]
    );
    return result.rows.length > 0;
  }
}
