# Overview
Build a Contentful App using Contentful App Framework (https://www.contentful.com/developers/docs/extensibility/app-framework/overview/) to build a custom Field-level app that allows a user to pick from a list of Contentful users, stored as an array in JSON format. We will then user a custom field editor (https://contentful-field-editors.netlify.app/?path=/docs/shared-localepublishingentitystatusbadge--docs) and/or Form 36 (https://f36.contentful.com/) element to overlay on top of the JSON field to give it the same look and feel as a normal contentful field.

After this, we will leverage this JSON data to inform to which users we need to assign a Contentful Task (https://www.contentful.com/help/content-and-entries/tasks/) to the specified user(s) when a Workflow (https://www.contentful.com/help/ai-automations/workflows/) reaches a certain step.

# Implementation Specifics

## JSON Field

- JSON Field ID to populate: "stakeholders"
- In order to populate the list of users we need to use Contentful's User Management API to fetch all users of a given Space (https://www.contentful.com/developers/docs/references/user-management-api/users/get-all-users-for-a-space/). This should store a JSON item with the user's First Name, Last Name, and User ID.
- This should field should use a Forma 36 Autocomplete (https://f36.contentful.com/components/autocomplete) for the user selection, and when an item is selected it should add a "Removable" PillNext component (https://f36.contentful.com/components/pill-next#removable), and these themselves should be placed within a Flex component (https://f36.contentful.com/components/flex) with "isInline" set to true so that they flow horizontally to fill their container before breaking to the next line.
- When an Autocomplete element is selected, it should add a new PillNext element populated with the user's first and last name.
- When a PillNext has it's close button clicked, it should remove the chosen PillNext element (e.g. the chosen user) from the JSON data

## Additional Information

- Please use the Glean MCP to vet any approaches you take to ensure that you are following best practices. You may also refer to the docs linked above.
- You may also use the Contentful MCP to review the given Space, should you need to get any additional information from Contentful, but you can also ask me to provide specifics as needed.
- You can see a similar implementation [here](https://raw.githubusercontent.com/eric-schmidt/contentful-required-tags/refs/heads/main/src/locations/Field.tsx); however, this is using the deprecated "Pill" component, so be sure to use the updated "PillNext" component in your implementation.