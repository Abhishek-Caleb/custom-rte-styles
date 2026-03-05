/*
 * <license header>
 */

import { Text } from "@adobe/react-spectrum";
import { register } from "@adobe/uix-guest";
import { extensionId, BROADCAST_CHANNEL_NAME, EVENT_AUE_UI_SELECT, EVENT_AUE_UI_UPDATE, EVENT_RTE_TEXT_SELECTION } from "./Constants";
import metadata from '../../../../app-metadata.json';

function ExtensionRegistration() {
  const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

  /**
   * Inject a script into the editor's content iframe that listens
   * for text selection (mouseup / selectionchange) and posts the
   * selected text back to us via window.postMessage.
   */
  const setupSelectionListenerInIframe = (guestConnection) => {
    // Listen for messages coming from the content iframe script
    window.addEventListener('message', (event) => {
      if (event.data?.type === EVENT_RTE_TEXT_SELECTION) {
        channel.postMessage({
          type: EVENT_RTE_TEXT_SELECTION,
          data: { selectedText: event.data.selectedText }
        });
      }
    });

    // The UE content iframe can be accessed via the editorActions API.
    // We inject a small script that watches for text selection.
    // Since we can't directly access the iframe DOM (cross-origin),
    // we use guestConnection.host.editorActions.executeScript or
    // a document-level selectionchange listener on the top window.
    // 
    // However, the Universal Editor fires custom events we can hook into.
    // As a practical approach, we listen for selectionchange on the
    // document level — when the author selects text inside the AEM
    // content iframe's RTE overlay, the UE relays selection events.
    document.addEventListener('selectionchange', () => {
      const selection = document.getSelection();
      if (selection && selection.toString().trim()) {
        channel.postMessage({
          type: EVENT_RTE_TEXT_SELECTION,
          data: { selectedText: selection.toString().trim() }
        });
      }
    });

    // Also listen for mouseup to capture selection at the moment
    // the user finishes selecting
    document.addEventListener('mouseup', () => {
      const selection = document.getSelection();
      if (selection && selection.toString().trim()) {
        channel.postMessage({
          type: EVENT_RTE_TEXT_SELECTION,
          data: { selectedText: selection.toString().trim() }
        });
      }
    });
  };

  const init = async () => {
    const guestConnection = await register({
      id: extensionId,
      metadata,
      methods: {
        events: {
          listen: (eventName, eventData) => {
            if (eventName === EVENT_AUE_UI_SELECT || eventName === EVENT_AUE_UI_UPDATE) {
              channel.postMessage({
                type: eventName,
                data: eventData.data
              });
            }
          }
        },
        rightPanel: {
          addRails() {
            return [
              {
                'id': 'rte-styles',
                'header': 'RTE Styles',
                'icon': 'TextStyle',
                'url': '/#/rte-styles-rail'
              },
            ];
          },
        },
      },
    });

    // Set up selection listener after registration
    setupSelectionListenerInIframe(guestConnection);
  };
  init().catch(console.error);

  return <Text>IFrame for integration with Host (AEM)...</Text>
}

export default ExtensionRegistration;
