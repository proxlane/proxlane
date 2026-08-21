---
'@proxlane/shared': patch
---

`orderChain`'s docstring described chain order backwards. Ranking best-first puts the least
healthy provider last, and the docs already recorded that; the source comment and the test named
after it still claimed the reverse, and that test asserted the opposite of its own title while
passing. Behaviour is unchanged — the comment was wrong, not the code.
