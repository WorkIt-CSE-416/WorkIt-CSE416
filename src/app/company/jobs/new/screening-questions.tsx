import { useId, useState } from "react";

import { Checkbox } from "@/components/shadcn/checkbox";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { FIELD_CONTROL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import { QUESTION_TYPES, type ScreeningQuestion } from "./data";
import { SelectField } from "./fields";
import { GripIcon, PlusIcon, TrashIcon } from "./icons";

/**
 * The editable list of questions an applicant answers before they can apply.
 *
 * REORDERING IS REAL, and that is the reason this file is the size it is. The
 * mockup draws a drag handle, and a handle that does not drag is exactly the
 * dead control the repo refuses to ship elsewhere — so it drags. Order matters
 * here: screening questions are read top to bottom by the applicant, and the
 * cheap question belongs before the essay.
 *
 * It is wired two ways on purpose. Pointer drag is what the handle looks like
 * it does; ArrowUp/ArrowDown on the focused handle is what makes it usable
 * without one, because HTML5 drag-and-drop is unreachable from a keyboard and
 * a keyboard-only recruiter would otherwise have to delete and retype a
 * question to move it. Both call the same move().
 *
 * WHY ONLY THE HANDLE IS `draggable`: putting it on the row would make the
 * inputs inside the row hard to select text in — a drag that starts in a text
 * box gets claimed by the row instead of the caret. The handle is the drag
 * source and the rows are the drop targets, which is also what the mockup's
 * grip implies.
 */
type ScreeningQuestionsProps = {
  questions: ScreeningQuestion[];
  onChange: (next: ScreeningQuestion[]) => void;
};

export function ScreeningQuestions({ questions, onChange }: ScreeningQuestionsProps) {
  /* Ids for questions added in this session. useId gives a per-instance prefix
     that is stable across a re-render and unique on the page, and the counter
     keeps them unique within the list — so a key never collides with a fixture
     id and never changes under a row that is only being edited. */
  const prefix = useId();
  const [added, setAdded] = useState(0);

  /** The row being dragged, and the row the pointer is currently over. */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function add() {
    setAdded((n) => n + 1);
    onChange([
      ...questions,
      { id: `${prefix}-${added}`, prompt: "", type: QUESTION_TYPES[0], required: false },
    ]);
  }

  function update(index: number, patch: Partial<ScreeningQuestion>) {
    onChange(questions.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function remove(index: number) {
    onChange(questions.filter((_, i) => i !== index));
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= questions.length || from === to) return;

    const next = [...questions];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  function endDrag() {
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <section>
      <SectionHeading
        as="h2"
        action={
          <Button variant="ghost" onClick={add}>
            <PlusIcon className="size-3.5" />
            Add Question
          </Button>
        }
      >
        Screening Questions
      </SectionHeading>

      {questions.length === 0 ? (
        <p className="text-note text-ink-faint mt-3">
          No screening questions. Applicants will send their profile and nothing else.
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2.5">
          {questions.map((question, index) => (
            <li
              key={question.id}
              onDragOver={(event) => {
                if (dragIndex === null) return;
                /* preventDefault is what marks this element a valid drop
                   target; without it the browser refuses the drop. */
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setOverIndex(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) move(dragIndex, index);
                endDrag();
              }}
              className={cn(
                "bg-well rounded-control border p-3 transition-colors",
                overIndex === index && dragIndex !== null && dragIndex !== index
                  ? "border-brand"
                  : "border-border-subtle",
                dragIndex === index && "opacity-50",
              )}
            >
              <div className="flex items-start gap-2.5">
                <IconButton
                  label={`Reorder question ${index + 1}. Use the arrow keys to move it.`}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    /* Firefox ignores a drag that carries no data. */
                    event.dataTransfer.setData("text/plain", question.id);
                    setDragIndex(index);
                  }}
                  onDragEnd={endDrag}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    /* Otherwise the arrow scrolls the page out from under the
                       row that just moved. */
                    event.preventDefault();
                    move(index, index + (event.key === "ArrowUp" ? -1 : 1));
                  }}
                  className="text-border-strong hover:text-ink-meta mt-2 cursor-grab active:cursor-grabbing"
                >
                  <GripIcon className="size-4" />
                </IconButton>

                {/* The one field on the screen with no visible label: the
                    ordinal is the label, and repeating "Question" over every
                    row would bury the questions themselves. w-auto because
                    FIELD_CONTROL is w-full and this one is sized by flex-1. */}
                <input
                  aria-label={`Question ${index + 1}`}
                  value={question.prompt}
                  onChange={(event) => update(index, { prompt: event.target.value })}
                  placeholder="What do you want to ask every applicant?"
                  className={cn(FIELD_CONTROL, "bg-panel w-auto min-w-0 flex-1 px-3 py-1.5")}
                />

                <IconButton
                  label={`Remove question ${index + 1}`}
                  onClick={() => remove(index)}
                  className="hover:text-ink mt-2"
                >
                  <TrashIcon className="size-4" />
                </IconButton>
              </div>

              {/* Indented to clear the handle, so the row's controls line up
                  under the question they belong to. */}
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 pl-6.5">
                <SelectField
                  id={`${question.id}-type`}
                  label={`Answer type for question ${index + 1}`}
                  hideLabel
                  value={question.type}
                  onValueChange={(type) => update(index, { type })}
                  options={QUESTION_TYPES}
                  className="w-40"
                />

                {/* A wrapping <label> with no htmlFor, which looks wrong and is
                    Base UI's documented pattern. Its Checkbox root is a
                    <span role="checkbox">, not an input, so neither a `for`
                    nor the wrapper names it on its own — but the root also
                    renders a visually hidden real checkbox, and Base UI walks
                    that input's .labels to find this element and points the
                    span's aria-labelledby at it after mount. The same hidden
                    input is what makes clicking the word toggle the box. */}
                <label className="text-label text-ink-muted flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={question.required}
                    onCheckedChange={(required) => update(index, { required })}
                  />
                  Required
                </label>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
