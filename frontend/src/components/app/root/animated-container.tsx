"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";
import { usePathname } from "next/navigation";

const SKIP_ANIMATION_ROUTES = ["/chat"];

interface AnimatedContainerProps {
    children: ReactNode;
    minHeight?: string;
    minWidth?: string;
}

export default function AnimatedContainer({
    children,
    minHeight,
    minWidth
}: AnimatedContainerProps) {
    const pathname = usePathname();
    const skipAnimation = SKIP_ANIMATION_ROUTES.includes(pathname);

    const containerStyle = {
        minHeight,
        minWidth,
    };

    if (skipAnimation) {
        return (
            <article
                data-component="desktop_chrome_animated-container"
                className="flex flex-col justify-start items-center flex-grow bg-background"
                style={containerStyle}
            >
                {children}
            </article>
        );
    }

    return (
        <motion.article
            data-component="desktop_chrome_animated-container"
            key={pathname}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col justify-start items-center flex-grow bg-background"
            style={containerStyle}
        >
            {children}
        </motion.article>
    );
}
