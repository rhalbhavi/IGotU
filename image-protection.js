document.addEventListener("contextmenu", (event) => {
  if (event.target instanceof Element && event.target.closest("img")) {
    event.preventDefault();
  }
});

document.addEventListener("dragstart", (event) => {
  if (event.target instanceof Element && event.target.closest("img")) {
    event.preventDefault();
  }
});
