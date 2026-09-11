import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  isGuest: boolean;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  signInAsGuest: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  // Default isGuest to false. If a user previously skipped, we can read from localStorage.
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    return localStorage.getItem('kcache_guest_mode') === 'true';
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error("Error getting session:", error.message);
        }
        
        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          
          // If we magically get a session, ensure guest mode is false
          if (session) {
            setIsGuest(false);
            localStorage.setItem('kcache_guest_mode', 'false');
          }
        }
      } catch (err) {
        console.error("Auth init exception:", err);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!mounted) return;
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession) {
          setIsGuest(false);
          localStorage.setItem('kcache_guest_mode', 'false');
        }
        setIsLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInAsGuest = () => {
    setIsGuest(true);
    localStorage.setItem('kcache_guest_mode', 'true');
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    // After sign out, maybe don't automatically become a guest so they hit the login screen
    // but the design says "Settings page: Sign Out button -> Clears local session"
    setSession(null);
    setUser(null);
    setIsGuest(false);
    localStorage.setItem('kcache_guest_mode', 'false');
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        isGuest,
        isLoading,
        signInAsGuest,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
