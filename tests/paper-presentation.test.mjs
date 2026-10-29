import test from "node:test";
import assert from "node:assert/strict";
import {
  getConsultationRoleLabel,
  getMeaningfulModified,
  getPaperTimelineStart,
  isBulkImportTimestamp,
} from "../src/shared/paper-presentation.ts";

test("the bulk import stamp is recognised", () => {
  assert.equal(isBulkImportTimestamp("2025-03-03T13:33:42+01:00"), true);
  assert.equal(isBulkImportTimestamp("2025-03-04T09:00:00+01:00"), false);
  assert.equal(isBulkImportTimestamp(undefined), false);
});

test("placeholder and repeated roles are not printed", () => {
  assert.equal(getConsultationRoleLabel("unbekannt", ""), "");
  assert.equal(getConsultationRoleLabel(" Unbekannt ", ""), "");
  assert.equal(getConsultationRoleLabel("Kenntnisnahme", "Kenntnisnahme"), "");
  assert.equal(
    getConsultationRoleLabel("Vorberatung", "vertagt"),
    "Vorberatung",
  );
  assert.equal(getConsultationRoleLabel(undefined, ""), "");
});

test("a migrated paper starts at its own date, not the migration day", () => {
  const migrated = {
    created: "2016-10-12T10:08:00+02:00",
    date: "2006-04-18",
  };
  assert.deepEqual(
    getPaperTimelineStart(migrated, "2006-05-09T16:30:00+02:00"),
    { value: "2006-04-18", precise: false },
  );
});

test("a current paper keeps its publication timestamp", () => {
  const paper = { created: "2026-09-01T10:00:00+02:00", date: "2026-09-01" };
  assert.deepEqual(getPaperTimelineStart(paper, "2026-10-20T16:00:00+02:00"), {
    value: paper.created,
    precise: true,
  });
  assert.deepEqual(getPaperTimelineStart(paper, undefined), {
    value: paper.created,
    precise: true,
  });
});

test("a file's change date is shown only when it says something", () => {
  assert.equal(
    getMeaningfulModified({
      created: "2016-10-12T10:00:00+02:00",
      modified: "2025-03-03T13:00:00+01:00",
    }),
    "",
  );
  assert.equal(
    getMeaningfulModified({
      created: "2026-09-01T10:00:00+02:00",
      modified: "2026-09-01T15:00:00+02:00",
    }),
    "",
  );
  assert.equal(
    getMeaningfulModified({
      created: "2026-09-01T10:00:00+02:00",
      modified: "2026-09-08T15:00:00+02:00",
    }),
    "2026-09-08T15:00:00+02:00",
  );
});
