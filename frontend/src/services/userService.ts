import { Api } from './api';
import { User } from '../types';

export const userService = {
  async getAll(): Promise<User[]> {
    const rows = await Api.users.getAll();
    return Array.isArray(rows) ? rows : [];
  },
};
