import { jsx as _jsx } from "react/jsx-runtime";
export default function RootLayout({ children }) {
    return (_jsx("html", { lang: "en", children: _jsx("body", { children: children }) }));
}
