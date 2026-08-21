---
'@proxlane/web': patch
---

The sticky header actually paints now. It emitted `bg-transparent` and its own override in one
class list, so Tailwind's layer order picked the transparent one while the blur applied anyway:
the header blurred the text behind it and put nothing on top. It is a floating glass pill, with
a scrim so content dissolves under it rather than being sliced.

Also fixes a hydration bug that broke the whole site's client JS: an `@proxlane/shared` barrel
import pulled `node:crypto` into the browser bundle.
