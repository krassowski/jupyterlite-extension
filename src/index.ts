import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { INotebookTracker, NotebookActions, NotebookPanel } from '@jupyterlab/notebook';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { ITranslator } from '@jupyterlab/translation';
import { Dialog, showDialog, ToolbarButton } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import { PageConfig } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { linkIcon, downloadIcon, caretDownIcon } from '@jupyterlab/ui-components';
import { INotebookContent } from '@jupyterlab/nbformat';
import { SharingService } from './sharing-service';
import { Menu } from '@lumino/widgets';
import { CommandRegistry } from '@lumino/commands';

/**
 * Debug logger
 */
function debugLog(...args: any[]): void {
  console.log('[JupyterEverywhere]', ...args);
}

/**
 * Get the current notebook panel
 */
function getCurrentNotebook(
  tracker: INotebookTracker,
  shell: JupyterFrontEnd.IShell,
  args: ReadonlyPartialJSONObject = {}
): NotebookPanel | null {
  const widget = tracker.currentWidget;
  const activate = args['activate'] !== false;

  if (activate && widget) {
    shell.activateById(widget.id);
  }

  return widget;
}

/**
 * Share dialog data interface.
 */
interface ShareDialogData {
  notebookName: string;
  isViewOnly: boolean;
  password: string;
}

/**
 * Share dialog widget for notebook sharing preferences (name, view-only, and a password if applicable).
 */
class ShareDialog extends Widget {
  constructor() {
    super();
    this.node.appendChild(this.createNode());
  }

  getValue(): ShareDialogData {
    const nameInput = this.node.querySelector('#notebook-name') as HTMLInputElement;
    const viewOnlyCheckbox = this.node.querySelector('#view-only') as HTMLInputElement;
    const passwordInput = this.node.querySelector('#password') as HTMLInputElement;

    return {
      notebookName: nameInput.value,
      isViewOnly: viewOnlyCheckbox.checked,
      password: passwordInput.value
    };
  }

  private createNode(): HTMLElement {
    const node = document.createElement('div');

    const nameLabel = document.createElement('label');
    nameLabel.htmlFor = 'notebook-name';
    nameLabel.textContent = 'Notebook Name:';

    const nameInput = document.createElement('input');
    nameInput.id = 'notebook-name';
    nameInput.type = 'text';
    nameInput.style.width = '100%';
    nameInput.style.marginBottom = '15px';
    nameInput.style.padding = '5px';
    nameInput.required = true;

    // For now, we can generate a default filename based on the
    // date sharing the notebook.
    const today = new Date();
    const defaultName = `Notebook_${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
    nameInput.value = defaultName;

    const viewOnlyContainer = document.createElement('div');
    viewOnlyContainer.style.marginBottom = '15px';

    const viewOnlyCheckbox = document.createElement('input');
    viewOnlyCheckbox.id = 'view-only';
    viewOnlyCheckbox.type = 'checkbox';
    viewOnlyCheckbox.style.marginRight = '5px';

    const viewOnlyLabel = document.createElement('label');
    viewOnlyLabel.htmlFor = 'view-only';
    viewOnlyLabel.textContent = 'Share as view-only notebook (password-protected)';

    viewOnlyContainer.appendChild(viewOnlyCheckbox);
    viewOnlyContainer.appendChild(viewOnlyLabel);

    // Password field
    const passwordContainer = document.createElement('div');
    passwordContainer.style.marginBottom = '15px';

    const passwordLabel = document.createElement('label');
    passwordLabel.htmlFor = 'password';
    passwordLabel.textContent = 'Password:';

    const passwordInput = document.createElement('input');
    passwordInput.id = 'password';
    passwordInput.type = 'text';
    passwordInput.style.width = '100%';
    passwordInput.style.padding = '5px';

    // This should be retrieved from the API but doesn't due to CORS issues;
    // generate a random password at this time.
    const generatePassword = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let password = '';
      for (let i = 0; i < 8; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return password;
    };

    passwordInput.value = generatePassword();
    passwordInput.disabled = !viewOnlyCheckbox.checked;

    // Toggle password field based on checkbox
    // TODO: doesn't yet dim the password field?
    viewOnlyCheckbox.addEventListener('change', () => {
      passwordInput.disabled = !viewOnlyCheckbox.checked;
    });

    passwordContainer.appendChild(passwordLabel);
    passwordContainer.appendChild(passwordInput);

    node.appendChild(nameLabel);
    node.appendChild(nameInput);
    node.appendChild(viewOnlyContainer);
    node.appendChild(passwordContainer);

    return node;
  }
}

/**
 * JUPYTEREVERYWHERE EXTENSION
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupytereverywhere:plugin',
  description: 'A Jupyter extension for k12 education',
  autoStart: true,
  requires: [INotebookTracker, ITranslator, IDocumentManager],
  activate: (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    translator: ITranslator,
    docManager: IDocumentManager
  ) => {
    debugLog('Extension is being activated...');

    // Get API URL from configuration or use a default
    const apiUrl =
      PageConfig.getOption('sharing_service_api_url') || 'http://localhost:8080/api/v1';
    debugLog('Using API URL:', apiUrl);

    const sharingService = new SharingService(apiUrl);

    const { commands, shell } = app;

    /**
     * 1. A "Download as IPyNB" command.
     */
    const downloadNotebookCommand = 'jupytereverywhere:download-notebook';
    commands.addCommand(downloadNotebookCommand, {
      label: 'Download as Notebook (.ipynb)',
      execute: args => {
        debugLog('Executing download as notebook command');
        // Execute the built-in download command
        return commands.execute('docmanager:download');
      }
    });

    /**
     * 2. A "Download as PDF" command.
     */
    const downloadPDFCommand = 'jupytereverywhere:download-pdf';
    commands.addCommand(downloadPDFCommand, {
      label: 'Download as PDF',
      execute: args => {
        debugLog('Executing download as PDF command');
        const current = getCurrentNotebook(tracker, shell, args);
        if (!current) {
          debugLog('No current notebook found');
          return Promise.resolve();
        }

        // Generate the URL for exporting as PDF
        // TODO: make this not open a new tab but rather download the file directly
        // Probably a target="_blank" not working issue?
        const url = PageConfig.getNBConvertURL({
          format: 'pdf',
          download: true,
          path: current.context.path
        });
        debugLog('Generated PDF URL:', url);

        return new Promise<void>(resolve => {
          // Execute all cells first before the notebook is exported
          // as the PDF export won't have the latest cell outputs otherwise
          debugLog('Running all cells before PDF export');
          void NotebookActions.runAll(current.content, current.context.sessionContext)
            .then(() => {
              // Save notebook if needed, then open the export URL
              const { context } = current;
              if (context.model.dirty && !context.model.readOnly) {
                debugLog('Notebook is dirty, saving before PDF export');
                void context
                  .save()
                  .then(() => {
                    debugLog('Notebook saved, opening PDF export URL');
                    window.open(url, '_blank', 'noopener');
                    resolve();
                  })
                  .catch(error => {
                    debugLog('Failed to save notebook:', error);
                    resolve();
                  });
              } else {
                debugLog('Notebook is clean, opening PDF export URL');
                window.open(url, '_blank', 'noopener');
                resolve();
              }
            })
            .catch(error => {
              debugLog('Failed to run all cells:', error);
              resolve();
            });
        });
      }
    });

    /**
     * Add custom Share notebook command
     */
    const shareNotebookCommand = 'jupytereverywhere:share-notebook';
    commands.addCommand(shareNotebookCommand, {
      label: 'Share Notebook',
      execute: () => {
        debugLog('Executing share notebook command');
        // We'll return a Promise that resolves when sharing is complete
        return new Promise<void>(async resolve => {
          try {
            const notebookPanel = tracker.currentWidget;
            if (!notebookPanel) {
              debugLog('No current notebook found');
              resolve();
              return;
            }

            // Save the notebook before we share it.
            debugLog('Saving notebook before sharing');
            await notebookPanel.context.save();

            const notebookContent = notebookPanel.context.model.toJSON() as INotebookContent;
            debugLog('Notebook content for sharing:', notebookContent);

            // Check if notebook has already been shared; access metadata using notebook content
            let notebookId: string | undefined;
            if (
              notebookContent.metadata &&
              typeof notebookContent.metadata === 'object' &&
              'sharedId' in notebookContent.metadata
            ) {
              notebookId = notebookContent.metadata.sharedId as string;
              debugLog('Found existing notebook ID in metadata:', notebookId);
            }

            const isNewShare = !notebookId;
            debugLog('Is new share:', isNewShare);

            debugLog('Opening share dialog');
            const result = await showDialog({
              title: isNewShare ? 'Share Notebook' : 'Update Shared Notebook',
              body: new ShareDialog(),
              buttons: [Dialog.cancelButton(), Dialog.okButton()]
            });

            if (result.button.accept) {
              const shareDialogData = result.value as ShareDialogData;
              const { notebookName, isViewOnly, password } = shareDialogData;
              debugLog('Share dialog data:', { notebookName, isViewOnly, password: '***' });

              try {
                // Show loading indicator
                // TODO: this doesn't show up in the dialog properly, we could
                // even remove it as loading doesn't take long at all
                debugLog('Showing loading indicator');
                const loadingIndicator = document.createElement('div');
                loadingIndicator.textContent = 'Sharing notebook...';
                loadingIndicator.style.position = 'fixed';
                loadingIndicator.style.bottom = '20px';
                loadingIndicator.style.right = '20px';
                loadingIndicator.style.padding = '10px';
                loadingIndicator.style.backgroundColor = '#f0f0f0';
                loadingIndicator.style.borderRadius = '5px';
                loadingIndicator.style.zIndex = '1000';
                document.body.appendChild(loadingIndicator);

                debugLog('Authenticating with sharing service');
                await sharingService.authenticate();

                let shareResponse;
                if (isNewShare) {
                  debugLog('Sharing new notebook');
                  shareResponse = await sharingService.share(
                    notebookContent,
                    isViewOnly ? password : undefined
                  );
                  debugLog('Share response:', shareResponse);
                } else if (notebookId) {
                  debugLog('Updating existing notebook with ID:', notebookId);
                  shareResponse = await sharingService.update(
                    notebookId,
                    notebookContent,
                    isViewOnly ? password : undefined
                  );
                  debugLog('Update response:', shareResponse);
                }

                if (shareResponse && shareResponse.notebook) {
                  debugLog('Storing metadata in notebook');
                  // We need to update the metadata in the notebookContent first
                  // to do this, and we need to ensure that the metadata object exists
                  if (!notebookContent.metadata) {
                    notebookContent.metadata = {};
                  }

                  notebookContent.metadata.sharedId = shareResponse.notebook.id;
                  notebookContent.metadata.readableId = shareResponse.notebook.readable_id;
                  notebookContent.metadata.sharedName = notebookName;
                  notebookContent.metadata.isPasswordProtected = isViewOnly;

                  debugLog('Updating notebook model with new metadata');
                  notebookPanel.context.model.fromJSON(notebookContent);
                }

                let shareableLink = '';
                if (shareResponse && shareResponse.notebook) {
                  const id = shareResponse.notebook.readable_id || shareResponse.notebook.id;
                  shareableLink = sharingService.makeRetrieveURL(id).toString();
                  debugLog('Generated shareable link:', shareableLink);
                }

                // Remove loading indicator
                document.body.removeChild(loadingIndicator);

                if (shareableLink) {
                  debugLog('Showing success dialog with shareable link');
                  void showDialog({
                    title: isNewShare
                      ? 'Notebook Shared Successfully'
                      : 'Notebook Updated Successfully',
                    body: new Widget({
                      node: (() => {
                        const container = document.createElement('div');
                        container.innerHTML = `
                          <p style="font-size: 1.2em; margin-bottom: 15px;">
                            ${isNewShare ? 'Your notebook is now shared!' : 'Your notebook has been updated!'} 
                            Use this link to access it:
                          </p>
                          <div style="text-align: center; margin: 15px 0; padding: 10px; background: #f5f5f5; border-radius: 4px;">
                            <a href="${shareableLink}" 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              style="font-size: 1.1em; color: #007bff; text-decoration: underline; word-break: break-all;">
                              ${shareableLink}
                            </a>
                          </div>
                          ${
                            isViewOnly
                              ? `<p style="margin-top: 15px;"><strong>Note:</strong> This notebook is password-protected.</p>`
                              : ''
                          }
                          <p style="font-size: 0.9em; margin-top: 15px;">
                            <strong>Important:</strong> Save this link to access your notebook later.
                          </p>
                        `;
                        return container;
                      })()
                    }),
                    buttons: [
                      Dialog.okButton({ label: 'Copy Link' }),
                      Dialog.cancelButton({ label: 'Close' })
                    ]
                  })
                    .then(result => {
                      if (result.button.label === 'Copy Link') {
                        debugLog('Copying link to clipboard');
                        void navigator.clipboard
                          .writeText(shareableLink)
                          .then(() => debugLog('Link copied to clipboard'))
                          .catch(err => debugLog('Failed to copy link:', err));
                      }
                      resolve();
                    })
                    .catch(() => resolve());
                } else {
                  debugLog('No shareable link generated');
                  resolve();
                }
              } catch (error) {
                debugLog('Error sharing notebook:', error);
                void showDialog({
                  title: 'Error',
                  body: new Widget({
                    node: (() => {
                      const container = document.createElement('div');
                      container.innerHTML = `
                        <p>Failed to share notebook: ${error instanceof Error ? error.message : 'Unknown error'}</p>
                      `;
                      return container;
                    })()
                  }),
                  buttons: [Dialog.okButton()]
                })
                  .then(() => resolve())
                  .catch(() => resolve());
              }
            } else {
              debugLog('Share dialog canceled');
              resolve();
            }
          } catch (error) {
            debugLog('Error in share dialog:', error);
            resolve();
          }
        });
      }
    });

    /**
     * Create download split button
     */
    // TODO: where did this vanish? :/
    const createDownloadSplitButton = (notebookPanel: NotebookPanel) => {
      debugLog('Creating download split button');

      // Main download button
      const downloadButton = new ToolbarButton({
        label: 'Download',
        icon: downloadIcon,
        tooltip: 'Download this notebook',
        onClick: () => {
          debugLog('Download button clicked');
          void commands.execute(downloadNotebookCommand);
        }
      });

      // TypeScript requires separate interface for the event handler
      // to avoid type errors (for some unexplained reason this is how it works)
      interface ButtonClickHandler {
        (evt: MouseEvent): void;
      }

      // Dropdown button handler
      const handleDropdownClick: ButtonClickHandler = event => {
        debugLog('Download dropdown clicked');
        event.stopPropagation();
        event.preventDefault();

        const menu = new Menu({ commands: commands as CommandRegistry });
        menu.addItem({ command: downloadNotebookCommand });
        menu.addItem({ command: downloadPDFCommand });
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        menu.open(rect.left, rect.bottom);
      };

      const dropdownButton = new ToolbarButton({
        icon: caretDownIcon,
        tooltip: 'Download options',
        // @ts-ignore - ToolbarButton's onClick typing is too restrictive
        onClick: handleDropdownClick
      });

      downloadButton.node.style.borderRadius = '4px 0 0 4px';
      downloadButton.node.style.marginRight = '0';
      downloadButton.node.style.borderRight = 'none';

      dropdownButton.node.style.borderRadius = '0 4px 4px 0';
      dropdownButton.node.style.marginLeft = '0';
      dropdownButton.node.style.width = '20px';
      dropdownButton.node.style.minWidth = '20px';

      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.marginRight = '4px';

      container.appendChild(downloadButton.node);
      container.appendChild(dropdownButton.node);

      return new Widget({ node: container });
    };

    /**
     * Create a "Share" button
     */
    const shareButton = new ToolbarButton({
      label: 'Share',
      icon: linkIcon,
      tooltip: 'Share this notebook',
      onClick: () => {
        debugLog('Share button clicked');
        void commands.execute(shareNotebookCommand);
      }
    });

    tracker.widgetAdded.connect((_, notebookPanel) => {
      if (notebookPanel) {
        debugLog('Adding buttons to notebook toolbar');

        // Look for the right position to insert the buttons (after the run buttons)
        // Looks like the Download button vanishes here
        let insertIndex = 5; // Default position
        const toolbar = notebookPanel.toolbar;

        // Add download-split button
        const downloadSplitButton = createDownloadSplitButton(notebookPanel);
        try {
          toolbar.insertItem(insertIndex, 'downloadSplitButton', downloadSplitButton);
          debugLog('Download button inserted at position', insertIndex);
          insertIndex++;
        } catch (error) {
          debugLog('Error inserting download button:', error);
          toolbar.addItem('downloadSplitButton', downloadSplitButton);
          debugLog('Download button added at the end');
        }

        // Add share button
        try {
          toolbar.insertItem(insertIndex, 'shareButton', shareButton);
          debugLog('Share button inserted at position', insertIndex);
        } catch (error) {
          debugLog('Error inserting share button:', error);
          // Fallback: add at the end
          toolbar.addItem('shareButton', shareButton);
          debugLog('Share button added at the end');
        }
      }
    });

    debugLog('JupyterEverywhere extension ready for demo');
  }
};

export default plugin;

