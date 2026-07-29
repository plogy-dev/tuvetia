import { SignupForm } from "@/components/signup-form"

export default function SignupPage() {
  return (
    <div className="app-theme relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="relative z-[1] w-full max-w-sm">
        <SignupForm />
      </div>
    </div>
  )
}
