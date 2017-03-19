'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {spawn} from 'child_process';
import * as moment from 'moment';
import * as crypto from 'crypto';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-paste-image" is now active!');

    let disposable = vscode.commands.registerCommand('extension.pasteImage', () => {
        Paster.paste();
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
}

class Paster {

    public static paste() {
        // get current edit file path
        let editor = vscode.window.activeTextEditor;
        if (!editor) return;

        let fileUri = editor.document.uri;
        if (!fileUri) return;
        if (fileUri.scheme === 'untitled') {
            vscode.window.showInformationMessage('Before paste image, you need to save current edit file first.');
            return;
        }

        // get selection as image file name, need check
        var selection = editor.selection;
        var selectText = editor.document.getText(selection);
        if(selectText && !/^[\w\-.]+$/.test(selectText)){
            vscode.window.showInformationMessage('Your selection is not a valid file name!');
            return;
        }

        // get image destination path
        let folderPathFromConfig = vscode.workspace.getConfiguration('pasteImage')['path'];
        if (folderPathFromConfig && (folderPathFromConfig.length !== folderPathFromConfig.trim().length)) {
            vscode.window.showErrorMessage('The specified path is invalid. "' + folderPathFromConfig + '"');
            return;
        }
        let filePath = fileUri.fsPath;
        let imagePath = this.getImagePath(filePath, selectText, folderPathFromConfig);

        this.createImageDirWithImagePath(imagePath).then(imagePath => {
            // save image and insert to current edit file
            this.saveClipboardImageToFileAndGetPath(imagePath, imagePath => {
                if(!imagePath) return;
                if(imagePath === 'no image'){
                    vscode.window.showInformationMessage('There is not a image in clipboard.');
                    return;
                }

                imagePath = this.renderFilePath(editor.document.languageId,filePath,imagePath);

                editor.edit(edit => {
                    let current = editor.selection;

                    imagePath = imagePath.replace(/\\/g, '/');
                    if(current.isEmpty){
                        edit.insert(current.start,imagePath);
                    }else{
                        edit.replace(current,imagePath);
                    }
                });
            });
        }).catch(err => {
            vscode.window.showErrorMessage('Failed make folder.');
            return;
        });
    }

    public static getImagePath(filePath: string, selectText: string, folderPathFromConfig: string): string {
        let imagePath = this.buildPathStr(filePath, selectText, folderPathFromConfig);
        while (fs.existsSync(imagePath)) {
            imagePath = this.buildPathStr(filePath, selectText, folderPathFromConfig);
        }
        return imagePath;
    }

    private static buildPathStr(filePath: string, selectText: string, folderPathFromConfig: string): any {
        // image file name
        let imageFileName = this.getImageFileName(selectText);
        // image output path
        return this.joinImageNameWithFilePath(filePath, imageFileName, folderPathFromConfig);
    }

    private static joinImageNameWithFilePath(filePath: string, imageFileName: string, folderPathFromConfig: string): string {
        let folderPath = path.dirname(filePath);
        let imagePath = "";

        // generate image path
        if (path.isAbsolute(folderPathFromConfig)) {
            imagePath = path.join(folderPathFromConfig, imageFileName);
        } else {
            imagePath = path.join(folderPath, folderPathFromConfig, imageFileName);
        }

        return imagePath;
    }

    private static getImageFileName(selectText: string): string{
        let imageFileName = "";
        if (! selectText) {
            let curFilePath = vscode.window.activeTextEditor.document.fileName;
            let fileNameEndIndex = curFilePath.lastIndexOf('.') == -1 ? curFilePath.length : curFilePath.lastIndexOf('.');
            let curFileName = curFilePath.substring(curFilePath.lastIndexOf(path.sep) + 1, fileNameEndIndex);
            imageFileName = curFileName + path.sep + crypto.randomBytes(4).toString('hex') + ".png";
        } else {
            imageFileName = selectText + ".png";
        }
        return imageFileName;
    }

    /**
     * create directory for image when directory does not exist
     */
    private static createImageDirWithImagePath(imagePath:string) {
        return new Promise((resolve, reject) => {
            let imageDir = path.dirname(imagePath);

            fs.exists(imageDir, (exists) => {
                if (exists) {
                    resolve(imagePath);
                    return;
                }

                fs.mkdir(imageDir, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(imagePath);
                });
            });
        });
    }

    /**
     * use applescript to save image from clipboard and get file path
     */
    private static saveClipboardImageToFileAndGetPath(imagePath,cb:(imagePath:string)=>void) {
        if (!imagePath) return;

        let platform = process.platform;
        if (platform === 'win32') {
            // Windows
            const scriptPath = path.join(__dirname, '../../res/pc.ps1');
            const powershell = spawn('powershell', [
                '-noprofile', 
                '-noninteractive',
                '-nologo',
                '-sta',
                '-executionpolicy','unrestricted',
                '-windowstyle', 'hidden',
                '-file', scriptPath,
                imagePath
            ]);
            powershell.on('exit', function(code, signal) {
                // console.log('exit', code, signal);
            });
            powershell.stdout.on('data', function (data: Buffer) {
                cb(data.toString().trim());
            });
        }
        else if(platform === 'darwin'){
            // Mac
            let scriptPath = path.join(__dirname, '../../res/mac.applescript');

            let ascript = spawn('osascript', [scriptPath, imagePath]);
            ascript.on('exit', function (code, signal) {
                // console.log('exit',code,signal);
            });

            ascript.stdout.on('data', function (data:Buffer) {
                cb(data.toString().trim());
            });
        } else {
            // Linux 

            let scriptPath = path.join(__dirname, '../../res/linux.sh');
            
            let ascript = spawn('sh', [scriptPath, imagePath]);
            ascript.on('exit', function (code, signal) {
                // console.log('exit',code,signal);
            });

            ascript.stdout.on('data', function (data:Buffer) {
                let result = data.toString().trim();
                if(result == "no xclip"){
                    vscode.window.showInformationMessage('You need to install xclip command first.');
                    return;
                }
                cb(result);
            });
        }
    }

    /**
     * render the image file path dependen on file type
     * e.g. in markdown image file path will render to ![](path)
     */
    public static renderFilePath(languageId:string,docPath:string,imageFilePath:string):string{
        imageFilePath = path.relative(path.dirname(docPath),imageFilePath);

        if(languageId === 'markdown'){
            return `![](${imageFilePath})`;
        }else{
            return imageFilePath;
        }
    }
}