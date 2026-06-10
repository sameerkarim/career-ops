# Mechanical structure audit for candidate-produced .xlsx workbooks.
# Pinned script — run verbatim inside the code-execution sandbox (openpyxl is
# pre-installed there). The runner's `audit` command uploads the workbook and
# instructs the model to execute exactly this file; the checks are fixed code,
# so the result is mechanical, not judged. Audit version: 1.0.
#
# Usage: python audit.py <workbook.xlsx>
# Prints one JSON object to stdout.

import json
import re
import sys

import openpyxl

PATH = sys.argv[1]

result = {
    "audit_version": "1.0",
    "opened": False,
    "sheets": [],
    "n_formula_cells": 0,
    "n_constant_numeric_cells": 0,
    "n_magic_numbers": 0,          # numeric literals inside formulas (excluding 0/1/100 and row/col refs)
    "magic_number_examples": [],
    "n_cross_sheet_refs": 0,       # formulas referencing another sheet (inputs separation signal)
    "defined_names": [],
    "has_inputs_like_sheet": False,
    "errors": [],
}

# Matches numeric literals in a formula AFTER cell references are stripped.
CELLREF = re.compile(r"(\$?[A-Za-z]{1,3}\$?\d{1,7})|('[^']+'|\w+)!")
NUMBER = re.compile(r"(?<![\w.])(\d+\.?\d*)(?![\w.])")
TRIVIAL = {"0", "1", "100", "12", "1.0"}  # unit/percent conversions, not magic

try:
    wb = openpyxl.load_workbook(PATH)
    result["opened"] = True
    result["defined_names"] = sorted(wb.defined_names.keys()) if wb.defined_names else []
    for ws in wb.worksheets:
        result["sheets"].append({"name": ws.title, "max_row": ws.max_row, "max_col": ws.max_column})
        if re.search(r"input|driver|assumption", ws.title, re.I):
            result["has_inputs_like_sheet"] = True
        for row in ws.iter_rows():
            for cell in row:
                v = cell.value
                if isinstance(v, str) and v.startswith("="):
                    result["n_formula_cells"] += 1
                    if "!" in v:
                        result["n_cross_sheet_refs"] += 1
                    stripped = CELLREF.sub(" ", v)
                    for num in NUMBER.findall(stripped):
                        if num not in TRIVIAL:
                            result["n_magic_numbers"] += 1
                            if len(result["magic_number_examples"]) < 10:
                                result["magic_number_examples"].append(
                                    f"{ws.title}!{cell.coordinate}: {v[:80]}"
                                )
                elif isinstance(v, (int, float)):
                    result["n_constant_numeric_cells"] += 1
except Exception as e:  # noqa: BLE001 — report, don't crash; the audit record carries the error
    result["errors"].append(str(e))

# Note for consumers: openpyxl does not evaluate formulas, and files written
# programmatically carry no cached values — numeric correctness is checked by
# the judge against the task's objective key, not here.
print(json.dumps(result))
