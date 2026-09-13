import { AuthForm } from "@/components/AuthForm";

export default function Register() {
  const demoHint = process.env.NODE_ENV !== "production" ? process.env.DEMO_LOGIN_HINT || undefined : undefined;
  return <AuthForm mode="register" demoHint={demoHint} />;
}
