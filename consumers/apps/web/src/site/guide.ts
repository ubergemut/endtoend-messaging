export type GuideEntry = {
  slug: string
  title: string
  shot: string
  features: string[]
  steps: string[]
}

export const guideSections = [
  { id: 'start', title: 'Getting started', description: 'Create an account, find a friend, and open your first chat.', slugs: ['register', 'login', 'inbox-empty', 'requests'] },
  { id: 'chat', title: 'Conversations & files', description: 'Send messages, follow replies, and talk in groups.', slugs: ['chat', 'thread', 'new-group', 'group', 'media'] },
  { id: 'privacy', title: 'Privacy & verification', description: 'Compare safety numbers and inspect the stored ciphertext.', slugs: ['safety', 'server-view'] },
  { id: 'phone', title: 'On your phone', description: 'Move between the chat list, a conversation, and a reply thread.', slugs: ['phone-list', 'phone-chat', 'phone-thread'] },
] as const

export const guide: GuideEntry[] = [
  {
    slug: 'register',
    title: 'Create an account',
    shot: '/guide/register.png',
    features: [
      'A handle comes first. Continue opens account creation when that handle is new.',
      'A warning that the keys are generated on this device.',
      'Create account, and a way back to the handle.',
    ],
    steps: [
      'Open the app and enter a handle of 3 to 32 letters, numbers, or underscores.',
      'Press Continue. A new handle opens account creation.',
      'Choose a password of at least 5 characters.',
      'Press Create account and wait while this browser generates the keys.',
    ],
  },
  {
    slug: 'login',
    title: 'Log in',
    shot: '/guide/login.png',
    features: [
      'Continue opens the password when the handle already exists.',
      'Log in, and a way back to the handle.',
      'A password opens the account only in the browser that still holds the keys.',
    ],
    steps: [
      'Enter the handle and press Continue.',
      'Enter the password for this device.',
      'Press Log in.',
      'If this browser has no keys for that account, the password cannot restore them.',
    ],
  },
  {
    slug: 'inbox-empty',
    title: 'Empty inbox',
    shot: '/guide/inbox-empty.png',
    features: [
      'Your handle, Log out, and Open another window.',
      'Requests and New group.',
      'An empty chat list, and the reminder that keys stay on this device.',
    ],
    steps: [
      'After the keys finish, the inbox is empty until someone accepts a request.',
      'Press Requests to find a person by handle.',
      'Press Open another window when you want a second seat in this same browser.',
      'Press Log out to clear this seat. The keys remain on the device until the browser data is removed.',
    ],
  },
  {
    slug: 'requests',
    title: 'Friend requests',
    shot: '/guide/requests.png',
    features: [
      'A handle field and an optional note.',
      'Incoming requests with Accept, Decline, and Block.',
      'The note opens only for the recipient.',
      'Outgoing requests show who you are waiting on, with Cancel.',
    ],
    steps: [
      'Press Requests.',
      'Type the other person\'s handle. Add a note if you want one.',
      'Press Send request. The note is sealed to their identity key before a session exists.',
      'On an incoming request, press Accept, Decline, or Block. On one you sent, press Cancel.',
    ],
  },
  {
    slug: 'chat',
    title: 'A conversation',
    shot: '/guide/chat.png',
    features: [
      'The chat list shows a preview and a time.',
      'The header names the person and shows Encrypted.',
      'The composer has the message, Disappearing, Attach, and Send.',
      'Your own message is marked sent, then delivered.',
      'Unseen messages stay marked until they are on screen. The chat list shows how many are still unseen.',
      'First unseen jumps to the oldest one. Jump to bottom returns to the latest.',
    ],
    steps: [
      'After a request is accepted, press the person in the chat list.',
      'Type a message and press Send.',
      'Sent means this device sealed it. Delivered means their device opened it and sent a receipt.',
      'Set Disappearing before you send if that message should expire.',
    ],
  },
  {
    slug: 'thread',
    title: 'A reply thread',
    shot: '/guide/thread.png',
    features: [
      'Reply expands the thread under the message, in the same chat.',
      'The thread has its own reply box.',
      'Open thread fills the chat with that thread.',
      'The parent stays in the conversation. Replies stay out of the main list.',
      'Opening a chat for a new reply opens that thread, and marks the message New.',
      'Each thread shows how many replies are still unseen.',
    ],
    steps: [
      'Press Reply on the message you are answering.',
      'Type in the thread reply box and press Send.',
      'Press Open thread to use the thread on its own, then Back to chat.',
      'Press Collapse to fold the thread back to its reply count.',
    ],
  },
  {
    slug: 'safety',
    title: 'Safety number',
    shot: '/guide/safety.png',
    features: [
      'The Encrypted chip opens the safety number for a direct chat.',
      'The number is grouped in fives.',
      'I verified this number marks the chat verified on this device only.',
    ],
    steps: [
      'Open a direct chat and press Encrypted, or Safety number.',
      'Compare the number with the other person on a channel you already trust.',
      'Press I verified this number after it matches. The chip then reads Encrypted · verified.',
      'If their identity key changes, sending stays blocked until you trust the new number on this device.',
    ],
  },
  {
    slug: 'server-view',
    title: 'What the server stored',
    shot: '/guide/server-view.png',
    features: [
      'Server view shows the ciphertext for the latest message in this chat.',
      'The envelope has no sender column.',
      'A file row has no filename.',
    ],
    steps: [
      'Open a chat that already has a message.',
      'Press Server view.',
      'Read the stored text. It is ciphertext, not the message you typed.',
      'Press Server view again to hide it.',
    ],
  },
  {
    slug: 'new-group',
    title: 'New group',
    shot: '/guide/new-group.png',
    features: [
      'A group name.',
      'A checkbox for each friend.',
      'Create group. A group cannot include someone who is not a friend.',
    ],
    steps: [
      'Accept at least one friend request first.',
      'Press New group.',
      'Type a name and check the friends who should be in it.',
      'Press Create group. The name is sealed to those friends. It is not stored in the clear.',
    ],
  },
  {
    slug: 'group',
    title: 'A group chat',
    shot: '/guide/group.png',
    features: [
      'The header shows the group name and Encrypted.',
      'Each message names the speaker.',
      'Members can be removed, a friend can be added, and you can leave.',
    ],
    steps: [
      'Press the group in the chat list.',
      'Send a message the same way you would in a direct chat.',
      'Use Add to bring in another friend, or Remove to take someone out.',
      'Press Leave to drop yourself. People who remain rotate their sender keys, so the next message does not open for someone who left.',
    ],
  },
  {
    slug: 'media',
    title: 'Files',
    shot: '/guide/media.png',
    features: [
      'Attach, or paste a file into the composer.',
      'A photo, video, audio file, or other file rides inside the encrypted message.',
      'A file over 25MB is refused before it is uploaded.',
    ],
    steps: [
      'Open a chat and press Attach, or paste a file into the message field.',
      'Press Send. The recipient sees the file. The server stores ciphertext, not the filename.',
      'If the file is over 25MB, the composer reports that it must be 25MB or smaller.',
    ],
  },
  {
    slug: 'phone-list',
    title: 'Phone: the chat list',
    shot: '/guide/phone-list.png',
    features: [
      'A narrow window shows the chat list on its own.',
      'The open conversation is hidden until you choose one.',
    ],
    steps: [
      'Use the app in a window narrower than 800 pixels, or on a phone.',
      'Pick a chat from the list.',
      'The list is replaced by that conversation.',
    ],
  },
  {
    slug: 'phone-chat',
    title: 'Phone: a chat',
    shot: '/guide/phone-chat.png',
    features: [
      'The conversation fills the screen.',
      'Back returns to the list.',
    ],
    steps: [
      'Open a chat from the list.',
      'Read and send as you would on a wide screen.',
      'Press Back to return to the list.',
    ],
  },
  {
    slug: 'phone-thread',
    title: 'Phone: a thread',
    shot: '/guide/phone-thread.png',
    features: [
      'Open thread fills the screen with the thread and its reply box.',
      'Back to chat returns to the conversation.',
    ],
    steps: [
      'Open a chat, press Reply, then Open thread.',
      'Read the thread and answer in its reply box.',
      'Press Back to chat, then Back to return to the list.',
    ],
  },
]
