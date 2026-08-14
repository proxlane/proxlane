---
"@proxlane/web": patch
---

Move the on-page contents into the sidebar, nested under the page it belongs to, and make it
sticky. It previously sat in the content column as a bordered list, which read as a block
quote rather than as navigation, and it scrolled away as soon as you started reading. The
current heading is tracked as you scroll, so the list says where you are rather than only
what exists.
