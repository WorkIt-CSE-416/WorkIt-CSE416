import type { Metadata } from "next";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Reset Password",
  description: "Get a link to set a new WorkIt password.",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
