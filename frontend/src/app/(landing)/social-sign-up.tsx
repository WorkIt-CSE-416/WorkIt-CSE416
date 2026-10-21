import { signInWithOAuth, type OAuthProvider } from "@/lib/oauth-actions";

/**
 * "Sign up with Google / LinkedIn", following Google's sign-in branding
 * guidelines (light theme): white fill, 1px #747775 inside stroke, #1F1F1F
 * Google Sans Medium 14/20 text, standard full-colour logos (never
 * recoloured). LinkedIn uses the same treatment so the pair matches. Each
 * posts to the same OAuth action as the buttons on /signup. The home hero
 * and every feature page's hero and closing call to action draw the pair.
 * https://developers.google.com/identity/branding-guidelines
 */
export function SocialSignUpButton({ provider }: { provider: OAuthProvider }) {
  const google = provider === "google";
  return (
    <form action={signInWithOAuth.bind(null, provider)} className="w-full max-w-72 sm:w-auto">
      <button
        type="submit"
        className="font-google inline-flex h-10 w-full items-center justify-center gap-2.5 rounded-full bg-white px-3 text-sm/5 font-medium whitespace-nowrap text-[#1F1F1F] ring-1 ring-[#747775] transition-shadow ring-inset hover:shadow-md"
      >
        {google ? (
          <svg viewBox="0 0 48 48" className="size-5 shrink-0" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
            <path
              fill="#0A66C2"
              d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
            />
          </svg>
        )}
        <span>{google ? "Sign up with Google" : "Sign up with LinkedIn"}</span>
      </button>
    </form>
  );
}
