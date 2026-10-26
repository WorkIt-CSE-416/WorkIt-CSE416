/**
 * Closes the modal on a link out of it. A parallel slot keeps showing what
 * it last matched on a soft navigation that matches nothing new (the Next.js
 * docs' modal pattern), so without this a link from Settings to My Profile
 * would leave the Settings modal open over My Profile (KAN-364).
 */
export default function NoModal() {
  return null;
}
