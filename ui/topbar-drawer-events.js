export function bindTopbarDrawerEvents(dom, handlers) {
  dom.openRightDrawer.addEventListener("click", () =>
    handlers.openDrawer("right", dom.openRightDrawer)
  );
  dom.drawerBackdrop.addEventListener("click", handlers.closeDrawers);

  dom.drawerCloseButtons.forEach((button) => {
    button.addEventListener("click", handlers.closeDrawers);
  });
}
