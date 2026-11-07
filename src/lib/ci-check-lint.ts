import { useState } from "react";

export function badHook(flag: boolean) {
  if (flag) {
    useState(0);
  }
  return null;
}
