"use client";

import { CircleHelp, Settings } from "lucide-react";
import { useState } from "react";

import { AccountMenu, type AccountMenuItem } from "@/components/account-menu";
import { Avatar } from "@/components/avatar";
import { ResumeUpload } from "@/components/resume-upload";
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";

/**
 * The kit's specimens that hold state or take a function, which a server page
 * cannot pass: the two vendored components, shown doing the thing they were
 * pulled in for, then the WorkIt controls and menus built on them.
 *
 * The two vendored ones are not styled here. They look like WorkIt because globals.css maps
 * shadcn's role names onto WorkIt's tokens — --popover is --color-panel, the
 * highlighted row's --accent is --color-hover — and because both compose
 * against the one Button, which answers to shadcn's variant names.
 *
 * `render` is Base UI's composition prop: it hands the trigger's behaviour and
 * accessibility wiring to an element you supply, rather than wrapping it.
 */

export function DialogSpecimen() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary">Withdraw Application</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">
            Withdraw This Application?
          </DialogTitle>
          <DialogDescription>
            Northwind will no longer see your profile for this role. You can apply again later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Keep It</Button>} />
          <DialogClose render={<Button variant="destructive">Withdraw</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DropdownSpecimen() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary">Sort By</Button>} />
      <DropdownMenuContent align="start" sideOffset={8} className="w-48">
        {/* The label has to sit inside a Group. Base UI's GroupLabel reads a
            context that only Menu.Group and Menu.RadioGroup provide, and throws
            rather than degrading when it is missing — the label exists to name
            a group, so a label with no group has nothing to name. Wrapping the
            items with it is also what gives the group its aria-labelledby. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort Results</DropdownMenuLabel>
          <DropdownMenuItem>Best Match</DropdownMenuItem>
          <DropdownMenuItem>Most Recent</DropdownMenuItem>
          <DropdownMenuItem>Salary, High to Low</DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem>Reset to Default</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A department picker, as the job composer uses one. */
export function SelectFieldSpecimen() {
  const [value, setValue] = useState("Engineering");

  return (
    <div className="w-72">
      <SelectField
        id="dk-department"
        label="Department"
        value={value}
        onValueChange={setValue}
        options={["Design", "Engineering", "Marketing", "Operations"]}
      />
    </div>
  );
}

/** The dropzone. A picked file only shows its preview; nothing uploads. */
export function ResumeUploadSpecimen() {
  const [file, setFile] = useState<File | null>(null);

  return (
    <div className="w-full max-w-md">
      <ResumeUpload file={file} onFileChange={setFile} onRemove={() => setFile(null)} />
    </div>
  );
}

const ACCOUNT_ROWS: AccountMenuItem[] = [
  { href: "/settings", label: "Settings", icon: <Settings aria-hidden className="size-4" /> },
  { href: "/help", label: "Help", icon: <CircleHelp aria-hidden className="size-4" /> },
];

/** Signing out from the kit would end a real session, so its row does nothing. */
const noSignOut = () => {};

/**
 * Both bars' account menus: the company bar's bare avatar, then the seeker
 * bar's photo, name and email, passed in as the trigger.
 */
export function AccountMenuSpecimen() {
  return (
    <>
      <AccountMenu name="Jordan Reyes" items={[]} onSignOut={noSignOut} />
      <AccountMenu
        name="Alex Chen"
        email="alex.chen@stonybrook.edu"
        items={ACCOUNT_ROWS}
        onSignOut={noSignOut}
      >
        <Avatar name="Alex Chen" className="text-label size-10" />
        <span className="min-w-0">
          <span className="text-label text-ink block max-w-48 truncate font-semibold">
            Alex Chen
          </span>
          <span className="text-note text-ink-meta block max-w-48 truncate">
            alex.chen@stonybrook.edu
          </span>
        </span>
      </AccountMenu>
    </>
  );
}
