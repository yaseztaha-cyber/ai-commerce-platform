import { AuthForm } from "@/components/AuthForm";

// Demo credentials hint is only shown in non-production when the operator
// explicitly sets DEMO_LOGIN_HINT (local dev only).
export default function Login() {
  const demoHint = process.env.NODE_ENV !== "production" ? process.env.DEMO_LOGIN_HINT || undefined : undefined;
  return <AuthForm mode="login" demoHint={demoHint} />;
}
