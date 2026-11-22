import { useAuth } from "@/context/AuthContext";

export default function useRetroAccess() {
  const { user } = useAuth();
  return {
    allowed: true,
    loading: false,
    error: null,
    signedIn: !!user?.uid,
    retry: () => {},
  };
}
