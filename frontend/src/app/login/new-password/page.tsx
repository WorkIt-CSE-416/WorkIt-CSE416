import type { Metadata } from "next";

import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = {
  title: "Set New Password",
  description: "Choose a new password for your WorkIt account.",
};

export default function NewPasswordPage() {
  return <NewPasswordForm />;
}
