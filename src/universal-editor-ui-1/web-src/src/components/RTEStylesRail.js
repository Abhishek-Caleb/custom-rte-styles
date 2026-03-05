/*
 * <license header>
 */
 
import React, { useState, useEffect } from 'react'
import { attach } from "@adobe/uix-guest"
import {
  Flex,
  Provider,
  Content,
  defaultTheme,
  Text,
  Button,
  Heading,
  ComboBox,
  Item,
  View
} from '@adobe/react-spectrum'

import {
  extensionId,
  EDS_GITHUB_ORG,
  EDS_GITHUB_REPO,
  RTE_STYLES_CSS_PATH,
  BROADCAST_CHANNEL_NAME,
  EVENT_AUE_UI_SELECT,
  EVENT_AUE_UI_UPDATE
} from "./Constants";

export default function RTEStylesRail () {
  // Fields
  const [guestConnection, setGuestConnection] = useState();
  const [editorState, setEditorState] = useState(null);
  const [richtextItem, setRichtextItem] = useState({});
  const [textValue, setTextValue] = useState("");
  const [rteStyles, setRteStyles] = useState([]);
  const [selectedStyle, setSelectedStyle] = useState("");
  const [markedText, setMarkedText] = useState("");

  /**
   * Extract the branch/ref from the editorState location URL.
   * The UE URL has ?ref=branchname in the query params.
   */
  const getRefFromEditorState = (state) => {
    try {
      const url = new URL(state.location);
      return url.searchParams.get('ref') || 'main';
    } catch (e) {
      console.error("Error extracting ref from editorState:", e);
      return 'main';
    }
  };

  /**
   * Build the URL for the AIO Runtime action that proxies the CSS fetch.
   * This avoids CORS issues since the action runs server-side.
   */
  const buildActionUrl = (state) => {
    const ref = getRefFromEditorState(state);
    // The action URL is relative to the AIO app's deployed origin
    // AIO Runtime actions are accessible at /api/v1/web/<package>/<action>
    const params = new URLSearchParams({
      ref,
      org: EDS_GITHUB_ORG,
      repo: EDS_GITHUB_REPO,
      path: RTE_STYLES_CSS_PATH,
    });
    return `/api/v1/web/custom-rte-styles/fetch-rte-styles?${params.toString()}`;
  };

  const updateRichtextWithGuest = async (editable) => {
    const target = {
      editable: { id: editable.id }
    };

    const patch = [{
      op: "replace",
      path: "/" + editable.prop,
      value: editable.content
    }]

    await guestConnection.host.editorActions.update( { target, patch });
  }

  const handleSelectionChange = async (styleName) => {
    if(!markedText)  return;
    
    setSelectedStyle(styleName);
    
    let updatedTextValue = textValue;

    if (markedText && textValue) {
      // Replace //markedText// with //[styleName] markedText//
      const escapedMarkedText = markedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const oldPattern = new RegExp(`(?<!:)\/\/${escapedMarkedText}\/\/`, 'g');
      const newPattern = `//[${styleName}] ${markedText}//`;
      
      updatedTextValue = textValue.replace(oldPattern, newPattern);
      setTextValue(updatedTextValue);
    }

    const updatedItem = {
      ...richtextItem,
      content: updatedTextValue
    };

    await updateRichtextWithGuest(updatedItem);

    await guestConnection.host.editorActions.refreshPage();
  };

  const handleShowStyled = async () => {
    const url = new URL(editorState.location);
    url.searchParams.set('wpRTEShowStyled', 'true');
    await guestConnection.host.editorActions.navigateTo(url.toString())
  };

  const handleShowMarked = async () => {
    const url = new URL(editorState.location);
    url.searchParams.set('wpRTEShowStyled', 'false');
    await guestConnection.host.editorActions.navigateTo(url.toString())
  };

  const convertSpanToMarkedText = (content) => {
    if (!content) return content;

    // Pattern: <span class="classname">text</span> to //[classname]text//
    const pattern = /<span class="([^"]+)">([^<]+)<\/span>/g;
    
    const converted = content.replace(pattern, '//[$1]$2//');
    
    return converted;
  };

  const extractMarkedText = (content) => {
    if (!content) return "";

    // Match //text// but NOT //[classname] text// ( ignore already styled text)
    const pattern = /(?<!:)\/\/(?!\[)([^\/]+?)\/\//;
    const match = content.match(pattern);

    return match ? match[1].trim() : "";
  };

  const loadRTEStyles = async (stylesUrl) => {
    try {
      console.log("loadRTEStyles: fetching CSS from action URL:", stylesUrl);
      const response = await fetch(stylesUrl);

      if (!response.ok) {
        console.error("loadRTEStyles: failed to fetch CSS, status:", response.status);
        return [];
      }

      const cssText = await response.text();
      console.log("loadRTEStyles: CSS loaded, length:", cssText.length);

      // Extract class names from CSS using regex, Pattern: .classname { ... }
      const classNameRegex = /\.([a-zA-Z0-9_-]+)\s*\{/g;
      const matches = [];
      let match;

      while ((match = classNameRegex.exec(cssText)) !== null) {
        matches.push(match[1]);
      }

      console.log("loadRTEStyles: found styles:", matches);
      setRteStyles(matches);
      return matches;
    } catch (error) {
      console.error("Error loading RTE styles:", error);
      return [];
    }
  };

  useEffect(() => {
    (async () => {
      const connection = await attach({ id: extensionId });
      setGuestConnection(connection);

      let state = await connection.host.editorState.get();
      setEditorState(state);

      // Use the AIO Runtime action to fetch CSS (avoids CORS)
      const actionUrl = buildActionUrl(state);
      console.log("RTEStylesRail: loading RTE styles via action:", actionUrl);

      await loadRTEStyles(actionUrl);

      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

      channel.onmessage = async (event) => {
        if (!event.data.type) {
          return;
        }

        if (event.data.type === EVENT_AUE_UI_SELECT || event.data.type === EVENT_AUE_UI_UPDATE) {
          state = await connection.host.editorState.get();
          setEditorState(state);

          const resource = event.data.type === EVENT_AUE_UI_SELECT ? event.data.data.resource : event.data.data.request.target.resource;
          let item = state.editables.filter( (editableItem) => editableItem.resource === resource)[0];

          if (item) {
            if (!item.content && item.children && item.children.length > 0) {
              //for custom blocks "richtext" is child of the custom block
              let child = state.editables.filter(
                (editableItem) => editableItem.id === item.children[0]
              )[0];
              child.resource = item.resource;
              item = child;
            }

            const convertedContent = convertSpanToMarkedText(item.content || "");
            setRichtextItem(item);
            setTextValue(convertedContent);
            setMarkedText(extractMarkedText(convertedContent));
          }
        }

        return () => {
          channel.close();
        };
      };
    })();
  }, []);

  return (
    <Provider theme={defaultTheme} colorScheme="dark" height="100vh">
      <Content height="100%">
        <View padding="size-200">
          <Heading marginBottom="size-100" level="3">Marked Text</Heading>
          <Text UNSAFE_style={{ fontStyle: markedText ? 'normal' : 'italic' }}>
            {markedText || "No marked text found, add using pattern // eg. //This is marked text//"}
          </Text>
          <Heading marginTop="size-300" marginBottom="size-100" level="3">Available Styles</Heading>
          <ComboBox selectedKey={selectedStyle} onSelectionChange={handleSelectionChange} width="100%" placeholder="Select Style" marginTop="size-200">
            {rteStyles.map((styleName) => (
              <Item key={styleName}>{styleName}</Item>
            ))}
          </ComboBox>
          <Flex direction="row" gap="size-100" marginTop="size-500">
            <Button variant="secondary" onPress={handleShowMarked} flex={1}>Show Marked</Button>
            <Button variant="secondary" onPress={handleShowStyled} flex={1}>Show Styled</Button>
          </Flex>
        </View>
      </Content>
    </Provider>
  );
}
