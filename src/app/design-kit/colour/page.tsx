import { SECTIONS } from "../data";
import { Palette } from "../palette";
import { KitPage } from "../specimen";

export const metadata = { title: SECTIONS.colour.title };

export default function ColourPage() {
  return (
    <KitPage {...SECTIONS.colour}>
      <Palette />
    </KitPage>
  );
}
