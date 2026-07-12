import { useCallback } from "react";
import { trpc } from "@/providers/trpc";

export type AuthUser = {
  id: number;
  nombre: string;
  email: string;
  rol: "SETTER" | "MANAGER" | "ADMIN";
};

export function useAuth() {
  const utils = trpc.useUtils();
  const { data: user, isLoading } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logout = useCallback(() => {
    localStorage.removeItem("operal_token");
    utils.auth.me.invalidate();
    window.location.href = "/login";
  }, [utils]);

  const isAdmin = user?.rol === "ADMIN" || user?.rol === "MANAGER";
  const isSetter = user?.rol === "SETTER";

  return {
    user: user as AuthUser | null | undefined,
    isLoading,
    isAuthenticated: !!user,
    isAdmin,
    isSetter,
    logout,
  };
}
