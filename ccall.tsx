interface Props {
  hangup: () => void;
  join: () => void;
  muteMike: () => void;
  hideCam: () => void;
}

interface RouteParams {
  id: string;
  name: string;
  profile: string;
  senderId: string;
  receiverId: string;
  isInitiatingCall: boolean; // Ensure this is boolean
}

export default function Call(props: Props) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [gettingCall, setGettingCall] = useState(false);
  const [isCallStarted, setIsCallStarted] = useState(false);
  const [isCallConnected, setIsCallConnected] = useState(false);
  const pc = useRef<RTCPeerConnection | null>(null);
  const connecting = useRef(false);
  const route = useRoute();
  const theme = useTheme();
  const currentUserId = auth.currentUser?.uid;

  // Extract ids from navigation params
  const { senderId, receiverId } = route.params as RouteParams;
  const otherUserId = senderId === currentUserId ? receiverId : senderId;
  const meetingId = [currentUserId, otherUserId].sort().join('_');

  const generateUniqueId = () => {
    const randomPart = Math.random().toString(36).substring(2, 10); // Generates random characters
    const timestampPart = Date.now().toString(36); // Converts current time to base 36 for compactness

    return `${randomPart}-${timestampPart}`;
};

    //const meetingId = generateUniqueId();
    // console.log(meetingId);
    
    const callDoc = db.collection('meet').doc(meetingId);
    //const callDoc = db.collection('meet').doc('meetingId');

    useEffect(() => {
        const sub = callDoc.onSnapshot(snap => {
            // Check if the snapshot exists and has data
            if (snap.exists) {
                const data = snap.data();
                //console.log(`The data is:`, data);
    
                // Check if remoteDescription is not set, and if calleeAnswer is available
                if (pc.current && !pc.current.remoteDescription && data && data.calleeAnswer) {
                    pc.current.setRemoteDescription(new RTCSessionDescription(data.calleeAnswer));
                    setIsCallConnected(true);
                }
    
                // Check for caller offer and start the call process
                if (data && data.callerOffer && !connecting.current) {
                    setGettingCall(true);
                }
            } else {
                console.warn('Document does not exist or is empty');
            }
        }, error => {
            console.error('Error fetching call document:', error);
        });
    
        const subscribeDelete = callDoc.collection('callee').onSnapshot(snap => {
            if (snap && !snap.empty) { // Check if the snapshot has documents
                snap.docChanges().forEach(change => {
                    if (change.type === 'removed') {
                        hangup();
                    }
                });
            } else {
                console.warn('No documents found in callee collection.');
            }
        }, (error) => {
            console.error('Error fetching callee documents:', error);
        });
    
        return () => {
            sub();  // Unsubscribe from call document
            subscribeDelete();  // Unsubscribe from callee collection
            
        }
    }, []);
    


const setupWebrtc = async () => {
    try {
      pc.current = new RTCPeerConnection(servers);
  
      const stream = await VideoUtils.getStream(); // Fetch local stream from camera/mic
      if (stream) {
        //console.log('Local stream retrieved:', stream);
        stream.getTracks().forEach(track => {
            if (pc.current) {
                pc.current.addTrack(track, stream);
            }
            setLocalStream(stream); // Set local stream to state
        });
      } else {
        console.error('Local stream is not available.');
      }
  
      pc.current.ontrack = (event: { streams: { getTracks: () => MediaStreamTrack[]; }[]; }) => {
        const remoteStream =  new MediaStream();
        event.streams[0].getTracks().forEach((track: MediaStreamTrack) => {
          remoteStream.addTrack(track);  // Add remote track to the MediaStream
        });
        //console.log('Remote stream set:', remoteStream);
        setRemoteStream(remoteStream);
      };
  
    } catch (error) {
      console.error('Error in setupWebrtc:', error);
    }
  };
  

  const handleStartCall = async () => {
      if (!isCallStarted) {
          console.log('Starting the call...');
          setIsCallStarted(true);
          await create(); // Start the call
      }
  };

  const create = async () => {
      console.log('Calling...');
      connecting.current = true;

      await setupWebrtc();

          // Call this after setting the local description
          collectionIceCandidates(callDoc, 'caller', 'callee');

      if (pc.current) {
          const offer = await pc.current.createOffer({});
           await pc.current.setLocalDescription(offer);

          const cWithOffer = {
              callerOffer: {
                  type: offer.type,
                  sdp: offer.sdp
              },
              senderId: currentUserId || otherUserId,
              receiverId: otherUserId || currentUserId,
          };

        try {
            await callDoc.set(cWithOffer);
        } catch (error) {
            console.error('Error setting caller document:', error);
        }
        
      }
  };

const join = async () => {
    console.log('Callee is joining the call...');
    connecting.current = true
    setGettingCall(false)
    
    // Get the offer from Firestore
    const offer = (await callDoc.get()).data()?.callerOffer;
    if (offer) {
        // Set up WebRTC for callee
        await setupWebrtc();

        // Collect ICE candidates for callee
       collectionIceCandidates(callDoc, 'callee', 'caller');  // Collect callee ICE candidates

        // Set the offer as remote description (caller sent this offer)
        if (pc.current) {
            await pc.current.setRemoteDescription(new RTCSessionDescription(offer));

            // Create answer and set it as local description
            const answer = await pc.current.createAnswer();
            await pc.current.setLocalDescription(answer);

            // Save the answer to Firestore for the caller to see
            const cWithAnswer = {
                calleeAnswer: {
                    type: answer.type,
                    sdp: answer.sdp
                },
                senderId: currentUserId || otherUserId,
                receiverId: otherUserId || currentUserId,
            }

            try {
                await callDoc.update(cWithAnswer);
            } catch (error) {
                console.error('Error updating callee document:', error);
            }
            
        }
    }
};


  const hangup = async () => {
      console.log('Ending the call...');
      setGettingCall(false);
      setIsCallConnected(false);
      setIsCallStarted(false);
      connecting.current = false;
      await streamCleanup();
      await databaseCleanup();

      if (pc.current) {
          pc.current.close();
          pc.current = null; // Clean up the peer connection
      }
      props.hangup()
  };

  const streamCleanup = async () => {
      if (localStream) {
          localStream.getTracks().forEach(track => {
              track.stop(); // Stop the track
              localStream.release()
          });
          setLocalStream(null);
          setRemoteStream(null);
      }
  };

  const databaseCleanup = async () => {
      if (callDoc) {
          const calleeCandidates = await callDoc.collection('callee').get();
          const deleteCalleePromises = calleeCandidates.docs.map(doc => doc.ref.delete());

          const callerCandidates = await callDoc.collection('caller').get();
          const deleteCallerPromises = callerCandidates.docs.map(doc => doc.ref.delete());

          await Promise.all([...deleteCalleePromises, ...deleteCallerPromises]);

          // Now delete the main call document
          await callDoc.delete();
      }
  };

  const collectionIceCandidates = async (
    callDoc: FirebaseFirestoreTypes.DocumentReference<FirebaseFirestoreTypes.DocumentData>,
    localName: string,
    remoteName: string
) => {
    // Reference to the local ICE candidates collection
    const candidatesCollection = callDoc.collection(localName);

    if(pc.current){
        pc.current.onicecandidate = (e: any) => {
            if (e.candidate && e.candidate.sdpMLineIndex !== null && e.candidate.sdpMid !== null) {
                candidatesCollection.add({
                    ...e.candidate.toJSON()  // Safely serialize the candidate
                });
            }

    callDoc.collection(remoteName).onSnapshot(snap => {
        if (snap && !snap.empty) {
            snap.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const candidateData = change.doc.data();
                    if (candidateData && candidateData.sdpMLineIndex !== null && candidateData.sdpMid !== null) {
                        const candidate = new RTCIceCandidate(candidateData);
                        pc.current?.addIceCandidate(candidate)
                            .catch(err => console.error("Failed to add ICE candidate", err));
                    } else {
                        console.warn("ICE candidate missing sdpMLineIndex or sdpMid", candidateData);
                    }
                }
            });
       }
    });
    
};


if (gettingCall) {
    return <GettingCall join={join} hangup={hangup}/>;
}

if (isCallConnected && remoteStream) {
    return (
      <Connected
        hangup={hangup}
        localStream={localStream}  // Pass local stream
        remoteStream={remoteStream}  // Pass remote stream
        handleMuteMic={props.muteMike}
        handleHideCam={props.hideCam}
      />
    );
  }
  
  // If the call is still starting and only the local stream is available
  if (localStream || remoteStream) {
    return (
      <Connected
        hangup={hangup}
        localStream={localStream}  // Only show the local stream initially
        remoteStream={remoteStream ? remoteStream : null}  // Remote stream might not be ready yet
        handleMuteMic={props.muteMike}
        handleHideCam={props.hideCam}
      />
    );
  }

    return (
        <View style={[styles.mainContainer, { backgroundColor: theme.videochat.backgroundColor }]}>
            <MapIcon2 
                handleMuteMic={props.muteMike} 
                handleHideCam={props.hideCam} 
                handleEndCall={hangup} 
                handleAcceptCall={handleStartCall} 
            />
        </View>
    );
}
