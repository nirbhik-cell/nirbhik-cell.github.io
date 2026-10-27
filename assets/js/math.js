// Render TeX with the self-hosted KaTeX build: \( inline \) and \[ display \] or $$ display $$.
window.addEventListener("DOMContentLoaded", function () {
  if (typeof renderMathInElement !== "function") return;
  document.querySelectorAll(".article__body").forEach(function (body) {
    renderMathInElement(body, {
      delimiters: [
        { left: "\\[", right: "\\]", display: true },
        { left: "$$", right: "$$", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
  });
});
