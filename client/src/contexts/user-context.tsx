import { createContext, useContext, ReactNode } from 'react';

export type UserRole = 'admin' | 'standard';

export interface UserContextValue {
  userName: string;
  userRole: UserRole;
  singleUserMode: boolean;
}

const UserContext = createContext<UserContextValue | null>(null);

interface UserProviderProps {
  userName: string;
  userRole: UserRole;
  singleUserMode: boolean;
  children: ReactNode;
}

export function UserProvider({
  userName,
  userRole,
  singleUserMode,
  children
}: UserProviderProps) {
  return (
    <UserContext.Provider value={{ userName, userRole, singleUserMode }}>
      {children}
    </UserContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUser(): UserContextValue {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
