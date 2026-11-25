<script lang="ts">
  import type { Approval, AskQuestion, QuestionAnnotations, QuestionAnswers } from "@squad/shared";
  import { untrack } from "svelte";
  import { send } from "../lib/state.svelte.ts";
  let { approval, questions }: { approval: Approval; questions: AskQuestion[] } = $props();

  const OTHER = "\u0000other";
  // Per question: the chosen labels (OTHER for the free-text choice) and the free text.
  // An approval's questions never change, so the initial value is all there is.
  let picked = $state<string[][]>(untrack(() => questions.map(() => [])));
  let other = $state<string[]>(untrack(() => questions.map(() => "")));
  // Questions with previews: the option whose preview shows (hovered or focused, else the last picked), and notes.
  const hasPreview = (q: AskQuestion) => q.options.some((o) => o.preview);
  let shown = $state<(number | null)[]>(untrack(() => questions.map(() => null)));
  let notes = $state<string[]>(untrack(() => questions.map(() => "")));

  function previewIndex(qi: number): number {
    const q = questions[qi];
    if (shown[qi] !== null) return shown[qi]!;
    const last = picked[qi].findLast((l) => q.options.some((o) => o.label === l));
    return last === undefined ? 0 : q.options.findIndex((o) => o.label === last);
  }

  function pick(qi: number, label: string, multi: boolean) {
    const cur = picked[qi];
    picked[qi] = multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label];
  }

  function answerFor(qi: number): string {
    return picked[qi].map((l) => (l === OTHER ? other[qi].trim() : l)).filter(Boolean).join(", ");
  }

  const answered = $derived(questions.every((_, qi) => answerFor(qi) !== ""));

  function submit() {
    const answers: QuestionAnswers = {};
    const annotations: QuestionAnnotations = {};
    questions.forEach((q, qi) => {
      answers[q.question] = answerFor(qi);
      const note = notes[qi].trim();
      const preview = q.options.find((o) => o.preview && picked[qi].includes(o.label))?.preview;
      if (note || preview) annotations[q.question] = { ...(note ? { notes: note } : {}), ...(preview ? { preview } : {}) };
    });
    send({ t: "approval.answer", approvalId: approval.id, decision: "allow", answers, annotations });
  }
  const skip = () => send({ t: "approval.answer", approvalId: approval.id, decision: "deny" });
</script>

<form class="ask" aria-label="Questions" onsubmit={(e) => { e.preventDefault(); if (answered) submit(); }}>
  {#each questions as q, qi (qi)}
    <fieldset>
      <legend>{#if q.header}<span class="chip">{q.header}</span>{/if} {q.question}</legend>
      <div class:split={hasPreview(q)}>
      <div class="opts">
      {#each q.options as o, oi (oi)}
        <label class="opt" class:shown={hasPreview(q) && previewIndex(qi) === oi}
          onmouseenter={() => (shown[qi] = oi)} onmouseleave={() => (shown[qi] = null)}
          onfocusin={() => (shown[qi] = oi)} onfocusout={() => (shown[qi] = null)}>
          <input type={q.multiSelect ? "checkbox" : "radio"} name="q{approval.id}-{qi}"
            checked={picked[qi].includes(o.label)} onchange={() => pick(qi, o.label, q.multiSelect)} />
          <span><strong>{o.label}</strong>{#if o.description}<span class="desc">{o.description}</span>{/if}</span>
        </label>
      {/each}
      <label class="opt">
        <input type={q.multiSelect ? "checkbox" : "radio"} name="q{approval.id}-{qi}"
          checked={picked[qi].includes(OTHER)} onchange={() => pick(qi, OTHER, q.multiSelect)} />
        <input class="other" type="text" placeholder="Other…" aria-label="Other answer" bind:value={other[qi]}
          oninput={() => { if (!picked[qi].includes(OTHER)) pick(qi, OTHER, q.multiSelect); }} />
      </label>
      </div>
      {#if hasPreview(q)}
        {@const p = q.options[previewIndex(qi)]}
        <div class="side">
          <pre class="preview" aria-label="Preview of {p.label}">{p.preview ?? "No preview for this option."}</pre>
          <textarea class="notes" rows="2" placeholder="Notes (optional)" aria-label="Notes" bind:value={notes[qi]}></textarea>
        </div>
      {/if}
      </div>
    </fieldset>
  {/each}
  <div class="btns">
    <button class="primary" type="submit" disabled={!answered}>Submit</button>
    <button type="button" onclick={skip} title="Decline; the squadmate asks in chat instead">Skip</button>
  </div>
</form>

<style>
  .ask { border: 1px solid var(--accent); border-radius: 8px; padding: 8px 10px; margin: 6px 0; background: color-mix(in srgb, var(--accent) 8%, var(--bg)); }
  fieldset { border: 0; margin: 0 0 8px; padding: 0; min-width: 0; }
  legend { padding: 0; margin-bottom: 4px; font-weight: 600; overflow-wrap: anywhere; }
  .chip { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 22%, transparent); margin-right: 4px; }
  .opt { display: flex; gap: 8px; align-items: flex-start; padding: 3px 0; cursor: pointer; }
  .opt > input[type="radio"], .opt > input[type="checkbox"] { margin-top: 3px; flex: none; }
  .desc { display: block; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
  .other { flex: 1; min-width: 0; }
  .split { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
  .split > .opts { flex: 1 1 180px; min-width: 0; }
  .split .opt { border-radius: 6px; padding: 3px 4px; }
  .split .opt.shown { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .side { flex: 2 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .preview { margin: 0; padding: 8px; max-height: 320px; overflow: auto; border: 1px solid var(--line); border-radius: 6px;
    background: var(--bg); font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
  .notes { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
