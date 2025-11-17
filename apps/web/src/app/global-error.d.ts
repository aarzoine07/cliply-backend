export default function GlobalError({ error }: {
    error: Error & {
        digest?: string;
    };
}): import("react").JSX.Element;
