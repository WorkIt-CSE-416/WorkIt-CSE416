"use client";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/shadcn/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Button } from "@/components/ui/button";

/**
 * The two vendored components, shown doing the thing they were pulled in for.
 *
 * Neither is styled here. They look like WorkIt because globals.css maps
 * shadcn's role names onto WorkIt's tokens — --popover is --color-panel, the
 * highlighted row's --accent is --color-brand-tint — and because both compose
 * against the one Button, which answers to shadcn's variant names.
 *
 * `render` is Base UI's composition prop: it hands the trigger's behaviour and
 * accessibility wiring to an element you supply, rather than wrapping it.
 */

export function DialogSpecimen() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary">Withdraw application</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw this application?</DialogTitle>
          <DialogDescription>
            Northwind will no longer see your profile for this role. You can apply again later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Keep it</Button>} />
          <DialogClose render={<Button variant="destructive">Withdraw</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DropdownSpecimen() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary">Sort by</Button>} />
      <DropdownMenuContent align="start" sideOffset={8} className="w-44">
        <DropdownMenuLabel>Sort results</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Best match</DropdownMenuItem>
        <DropdownMenuItem>Most recent</DropdownMenuItem>
        <DropdownMenuItem>Salary, high to low</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
