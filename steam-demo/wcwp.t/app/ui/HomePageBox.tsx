import Image from "next/image";
import Link from "next/link";
import styles from './HomePageBox.module.scss';

export default function HomePageBox() {
    return (
        <div className={styles.mainBox}>
            <Image src="/Images/MainTitleLogo.png" alt="Main Logo" width="590" height="193" className={styles.mainImage} />
            <p> What Can We Play Today is a tool for finding shared games amongst Steam Gamers. If you're a Steam gamer yourself, you can use the Steam login button below to directly login with your Steam account OR use the Alternate Login if you know your Steam ID already. 
            </p>
            <br></br>
            <p> Feel free to try the demo below to see how it all works! </p>
            <br></br>
            <p>By using our site, you acknowledge that you have read and understand our <Link href="/privacy-policy">PRIVACY POLICY</Link></p>
        </div>
    );
}