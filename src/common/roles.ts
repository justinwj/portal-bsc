export enum UserRole {
  ADMIN = 'admin',
  MEMBER = 'member',
}

export type RoleName = UserRole.ADMIN | UserRole.MEMBER;

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  role: RoleName;
}
