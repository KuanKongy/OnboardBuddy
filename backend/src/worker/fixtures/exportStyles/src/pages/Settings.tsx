declare function memo<T>(component: T): T;

/** HOC-wrapped default export — still the page, so still a `ui_route`. */
const Settings = () => 'settings';

export default memo(Settings);
