---
"@proxlane/ui": patch
"@proxlane/web": patch
---

Quieten the schematic background field, which was reading as ruling behind the type: the rule
mixes into the ground at 22% instead of 42%, the cell grows to 128px, and the mask fades from
30%. Density mattered as much as contrast — at 96px a 1440px viewport carried fifteen columns
of line.
