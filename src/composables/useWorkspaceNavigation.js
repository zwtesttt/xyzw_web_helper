import { inject } from "vue";

export const WORKSPACE_NAVIGATION_KEY = Symbol("xyzw-workspace-navigation");

/** Use the in-shell tab adapter when present; preserve router behavior elsewhere. */
export function useWorkspaceNavigation(router) {
  const workspaceNavigation = inject(WORKSPACE_NAVIGATION_KEY, null);

  return {
    push(location) {
      return workspaceNavigation
        ? workspaceNavigation.navigate(location, "push")
        : router.push(location);
    },
    replace(location) {
      return workspaceNavigation
        ? workspaceNavigation.navigate(location, "replace")
        : router.replace(location);
    },
  };
}
