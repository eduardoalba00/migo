import { useState } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { useWorkspaceStore } from "@/stores/workspace";

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  return (
    <div className="flex flex-1 items-center justify-center bg-background">
      {mode === "login" ? (
        <LoginForm onSwitchToRegister={() => setMode("register")} />
      ) : (
        <RegisterForm onSwitchToLogin={() => setMode("login")} />
      )}
      <button
        onClick={() => setActiveWorkspace(null)}
        className="absolute bottom-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        Change workspace
      </button>
    </div>
  );
}
