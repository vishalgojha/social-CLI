import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";

export function Panel(props: {
  title: string;
  subtitle?: string;
  focused?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const theme = useTheme();
  return (
    <Box
      borderStyle={props.focused ? "single" : "round"}
      borderColor={props.focused ? theme.accent : theme.muted}
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Text color={props.focused ? "cyanBright" : theme.text}>[{props.title}]</Text>
        {props.subtitle ? <Text color={theme.muted}>{props.subtitle}</Text> : null}
      </Box>
      {props.children}
    </Box>
  );
}

