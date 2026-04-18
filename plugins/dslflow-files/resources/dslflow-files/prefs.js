// Word-wrap preference stored in localStorage.
const DSFF_WRAP_KEY = "dslflow.files.wordwrap";

function dsffWrapEnabled() {
  return localStorage.getItem(DSFF_WRAP_KEY) === "1";
}

function dsffSetWrap(on) {
  if (on) localStorage.setItem(DSFF_WRAP_KEY, "1");
  else     localStorage.removeItem(DSFF_WRAP_KEY);
}
