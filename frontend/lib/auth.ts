'use client';

import { useState, useEffect } from 'react';

export interface User {
  id: string;
  name: string;
  email: string;
  picture?: string;
  walletAddress?: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => void;
}

// Mock Google OAuth for demo purposes
export const useAuth = (): AuthState => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is already logged in (from localStorage)
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (error) {
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  const login = async () => {
    setLoading(true);
    try {
      // Mock Google OAuth flow for demo
      // In real implementation, this would use Google OAuth
      const mockUsers = [
        {
          id: 'demo-user-1',
          name: 'John Smith',
          email: 'john.smith@gmail.com',
          picture: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face',
        },
        {
          id: 'demo-user-2',
          name: 'Sarah Johnson',
          email: 'sarah.johnson@gmail.com',
          picture: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?w=150&h=150&fit=crop&crop=face',
        },
        {
          id: 'demo-user-3',
          name: 'Mike Wilson',
          email: 'mike.wilson@gmail.com',
          picture: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face',
        }
      ];
      
      // Randomly select a demo user
      const mockUser = mockUsers[Math.floor(Math.random() * mockUsers.length)];

      // Simulate OAuth delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setUser(mockUser);
      localStorage.setItem('user', JSON.stringify(mockUser));
    } catch (error) {
      console.error('Login failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('user');
  };

  return { user, loading, login, logout };
};

// Real Google OAuth implementation (for later)
export const useGoogleAuth = (): AuthState => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initialize Google OAuth
    const initGoogleAuth = async () => {
      if (typeof window !== 'undefined' && window.google) {
        try {
          await window.google.accounts.oauth2.initTokenClient({
            client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
            scope: 'email profile',
            callback: (response: any) => {
              // Handle OAuth response
              console.log('OAuth response:', response);
            }
          });
        } catch (error) {
          console.error('Google Auth initialization failed:', error);
        }
      }
      setLoading(false);
    };

    initGoogleAuth();
  }, []);

  const login = async () => {
    // Google OAuth login implementation
    console.log('Google login not implemented yet');
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('user');
  };

  return { user, loading, login, logout };
};
