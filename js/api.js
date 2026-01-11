import { getState } from './state.js';
import { generateSpritePrompt, SPRITE_SYSTEM_PRIMER, STYLE_PROMPTS } from './prompts.js';

/**
 * Calls Google Gemini Image Edit endpoint and returns a data URL.
 * Takes a reference image and transforms it according to the prompt.
 */
export async function callGeminiEdit(prompt, imageFile, apiKey) {
  const state = getState();
  
  // Use provided API key or fallback to the one in state
  const key = apiKey || state.apiKey;
  
  console.log('Calling Gemini 2.5 Flash Image API with:', {
    promptLength: prompt.length,
    imageSize: imageFile.size,
    hasApiKey: !!key
  });

  try {
    // Ensure we're working with a proper file object
    if (!(imageFile instanceof File || imageFile instanceof Blob)) {
      throw new Error('Invalid image type: expected File or Blob');
    }

    // Convert file to base64
    const base64Image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });

    // Construct the payload for Gemini 2.5 Flash Image
    // Note: We are using the generateContent endpoint which supports multimodal input
    // This model allows prompting with both text and images
    const payload = {
      contents: [{
        parts: [
          // Prepend system primer as instruction
          { text: SPRITE_SYSTEM_PRIMER + "\n\n" + prompt },
          {
            inline_data: {
              mime_type: imageFile.type || 'image/png',
              data: base64Image
            }
          }
        ]
      }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
            aspectRatio: "1:1" // We want square output
        }
      }
    };

    console.log('Gemini Payload prepared');

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + key, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Gemini API error details:', errorData);
      throw new Error(errorData.error?.message || `API call failed with status ${response.status}`);
    }

    const result = await response.json();
    
    // Check if we have candidates
    if (!result.candidates || result.candidates.length === 0) {
       console.error('Unexpected API response format:', result);
       throw new Error('No candidates returned from Gemini API');
    }

    const candidate = result.candidates[0];

    // Look for image part in the response
    const imagePart = candidate.content.parts.find(p => p.inline_data);

    if (!imagePart || !imagePart.inline_data || !imagePart.inline_data.data) {
       console.error('No image data in response:', result);
       throw new Error('Invalid response format: No image generated');
    }
    
    return `data:${imagePart.inline_data.mime_type};base64,${imagePart.inline_data.data}`;

  } catch (error) {
    console.error('Error in Gemini API call:', error);
    throw error;
  }
}

// Helper function to convert image to PNG using canvas
async function convertToPNG(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      // Clear with transparent background
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Draw image, preserving transparency
      ctx.drawImage(img, 0, 0);
      
      canvas.toBlob(
        (blob) => {
          const pngFile = new File([blob], 'image.png', { 
            type: 'image/png',
            lastModified: Date.now()
          });
          console.log('PNG conversion complete:', {
            originalSize: file.size,
            newSize: pngFile.size,
            dimensions: `${canvas.width}x${canvas.height}`,
            hasTransparency: 'preserved'
          });
          resolve(pngFile);
        },
        'image/png',
        1.0
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Helper to read a file as data URL
 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Helper function to convert a data URL to a File object with transparency preserved
export async function dataURLtoFile(dataUrl, filename) {
  try {
    // Validate the dataUrl format
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      console.error('Invalid data URL format:', dataUrl ? `${dataUrl.substring(0, 20)}...` : 'null or undefined');
      throw new Error('Invalid data URL format');
    }

    // For image data URLs, ensure proper transparency handling
    if (dataUrl.startsWith('data:image')) {
      // Create an Image element to load the data URL
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Failed to load image from data URL'));
        img.src = dataUrl;
      });

      // Create a canvas with the same dimensions as the image
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw the image with transparency preserved
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Convert to PNG blob with transparency
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to create image blob'));
            return;
          }

          const file = new File([blob], filename, {
            type: 'image/png',
            lastModified: Date.now()
          });

          console.log('Data URL successfully converted to File with transparency:', {
            size: file.size,
            type: file.type,
            dimensions: `${img.width}x${img.height}`
          });

          resolve(file);
        }, 'image/png', 1.0);
      });
    }

    // Fallback for non-image data URLs
    console.log('Converting data URL to file using fetch API (fallback)');
    const res = await fetch(dataUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch data URL: ${res.status} ${res.statusText}`);
    }

    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || 'image/png' });
  } catch (error) {
    console.error('Error converting data URL to file:', error);
    throw new Error(`Failed to convert image: ${error.message}`);
  }
}

// Validate API Key helper
function validateApiKey() {
    const { apiKey } = getState();
    if (!apiKey) {
      throw new Error('Please enter your Google Gemini API key');
    }
    return apiKey;
}

// Generate sprite styles
export async function generateSpriteStyles(imageFile) {
  try {
    const apiKey = validateApiKey();

    // Generate a unique reference token for this character
    const referenceToken = `CHAR_${Date.now().toString(36)}`;
    
    // First ensure imageFile is a proper PNG
    let processedImage;
    try {
      // If it's not already a PNG, convert it
      if (imageFile.type !== 'image/png') {
        console.log('Converting image to PNG...');
        processedImage = await convertToPNG(imageFile);
      } else {
        processedImage = imageFile;
      }
      console.log('Image ready for processing:', {
        type: processedImage.type,
        size: processedImage.size
      });
    } catch (error) {
      console.error('Image processing error:', error);
      throw new Error('Failed to process the uploaded image');
    }
    
    // Generate prompts for each style
    const stylePromises = STYLE_PROMPTS.map(async (style) => {
      try {
        // Generate the prompt for this style
        const prompt = generateSpritePrompt(style.id, 'idle', referenceToken);
        console.log(`Generating style ${style.id} with prompt length ${prompt.length}`);
        
        // Call the Gemini API
        const result = await callGeminiEdit(prompt, processedImage, apiKey);
        console.log(`Style ${style.id} generation complete`);
        
        return {
          id: style.id,
          imageUrl: result
        };
      } catch (error) {
        console.error(`Error generating ${style.id} style:`, error);
        // Return an object with error information instead of null
        // This allows us to show error state in the UI for this style
        return {
          id: style.id,
          error: error.message || 'Generation failed'
        };
      }
    });

    // Wait for all promises to resolve, even those that failed
    const results = await Promise.allSettled(stylePromises);
    
    // Process the results
    const successfulStyles = results
      .filter(result => result.status === 'fulfilled' && result.value && result.value.imageUrl)
      .map(result => result.value);
      
    // Log how many styles were generated successfully
    console.log(`Successfully generated ${successfulStyles.length} out of ${STYLE_PROMPTS.length} styles`);
    
    if (successfulStyles.length === 0) {
      throw new Error('Failed to generate any styles. Please check your API key and try again.');
    }
    
    return successfulStyles;
  } catch (error) {
    console.error('Error in generateSpriteStyles:', error);
    throw error;
  }
}

// Generate sprite action
export async function generateSpriteAction(styleId, actionId, frameIndex = 0, isContinuation = frameIndex > 0) {
  try {
    const apiKey = validateApiKey();
    const state = getState();

    // Debugging: log state information
    console.log('generateSpriteAction state info:', {
      styleId,
      actionId,
      frameIndex,
      isContinuation,
      isSequential: frameIndex > 0,
      hasUploadedImage: !!state.uploadedImage,
      uploadedImageType: state.uploadedImage?.type,
      hasGeneratedStyles: Array.isArray(state.generatedStyles),
      generatedStylesCount: state.generatedStyles?.length || 0,
      stylesGenerated: state.generatedStyles?.map(s => s.id) || [],
      existingFrames: state.generatedFrames?.[actionId]?.length || 0
    });
    
    // Get the image to use as a base
    let imageToUse = state.uploadedImage;
    let inputSource = 'original';
    
    // SEQUENTIAL ANIMATION LOGIC:
    // For sequential animation, we need to ensure proper frame continuity
    // by using previous frames as input when appropriate
    
    // First, check if we have previously generated frames for this action
    // and if we're generating a frame after the first one
    if (isContinuation && frameIndex > 0 && state.generatedFrames) {
      // Find the specific frame from the generatedFrames array
      const framesForAction = state.generatedFrames.filter(f => f.actionId === actionId && f.styleId === styleId);
      const previousFrameIndex = frameIndex - 1;
      const prevFrame = framesForAction.find(f => f.frameIndex === previousFrameIndex);
      
      // If the previous frame exists, use it as the input for this frame
      // This creates a chain of generation that maintains consistency
      if (prevFrame && prevFrame.imageUrl) {
        try {
          console.log(`SEQUENTIAL ANIMATION: Using frame ${previousFrameIndex} as input for frame ${frameIndex}`);
          const prevFrameFile = await dataURLtoFile(
            prevFrame.imageUrl,
            `previous_frame_${previousFrameIndex}.png`
          );
          imageToUse = prevFrameFile;
          inputSource = 'previous_frame';
          
          console.log('Successfully prepared previous frame as input for sequential animation:', {
            type: imageToUse.type,
            size: imageToUse.size,
            frameIndex: previousFrameIndex,
            nextFrameIndex: frameIndex
          });
        } catch (error) {
          console.error('Error preparing previous frame for sequential animation:', error);
          console.warn('Falling back to styled image or original image');
        }
      } else {
        console.warn(`Missing previous frame ${previousFrameIndex} for sequential animation`);
      }
    }
    // If we're not using a previous frame (or failed to), and this isn't the original style,
    // try to use the styled image as base instead
    else if (styleId !== 'original') {
      const styledImage = state.generatedStyles?.find(s => s.id === styleId);
      
      if (styledImage && styledImage.imageUrl) {
        console.log(`Using generated ${styleId} style image for action frame generation`);
        
        try {
          // Make sure the data URL is valid
          if (!styledImage.imageUrl.startsWith('data:image/')) {
            throw new Error('Invalid data URL format for styled image');
          }
          
          // Convert the data URL to a File object
          imageToUse = await dataURLtoFile(styledImage.imageUrl, 'styled_image.png');
          inputSource = 'styled_image';
          
          console.log('Successfully converted styled image to File:', {
            type: imageToUse.type,
            size: imageToUse.size
          });
        } catch (convError) {
          console.error('Error preparing styled image:', convError);
          console.warn(`Falling back to original image due to conversion error`);
        }
      } else {
        console.warn(`No generated style found for ${styleId}, falling back to original image`);
      }
    }

    // Double-check that we have a valid image to use
    if (!(imageToUse instanceof File || imageToUse instanceof Blob)) {
      throw new Error('Invalid image format: need File or Blob for API call');
    }

    // Ensure we're using PNG with transparency
    if (imageToUse.type !== 'image/png') {
      console.log('Converting input image to PNG to ensure transparency support...');
      imageToUse = await convertToPNG(imageToUse);
    }

    // Generate a unique reference token for this character
    const referenceToken = `CHAR_${Date.now().toString(36)}`;
    
    // Generate the prompt for the action with specific frame index and continuity flag
    const prompt = generateSpritePrompt(
      styleId, 
      actionId, 
      referenceToken, 
      undefined, 
      frameIndex, 
      isContinuation
    );
    
    console.log(`Generating ${actionId} frame ${frameIndex+1} in ${styleId} style:`, {
      type: imageToUse.type,
      size: imageToUse.size,
      name: imageToUse.name,
      inputSource: inputSource,
      isContinuation: isContinuation,
      isSequential: frameIndex > 0,
      promptLength: prompt.length
    });
    
    const result = await callGeminiEdit(prompt, imageToUse, apiKey);

    return {
      id: actionId,
      frameIndex: frameIndex,
      imageUrl: result,
      generatedFromPrevious: inputSource === 'previous_frame',
      styleId: styleId
    };
  } catch (error) {
    console.error(`Error in generateSpriteAction for frame ${frameIndex+1}:`, error);
    throw error;
  }
}

// Deprecated export for backward compatibility if needed, but updated to use callGeminiEdit if called
export async function callOpenAIEdit(prompt, imageFile, apiKey) {
    console.warn('callOpenAIEdit is deprecated, redirecting to callGeminiEdit');
    return callGeminiEdit(prompt, imageFile, apiKey);
}
